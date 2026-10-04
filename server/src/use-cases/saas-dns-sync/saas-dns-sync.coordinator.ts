import { ApiError } from '../../kernel/http/api-error.js'
import { normalizeFqdn } from '../../lib/values.js'
import { runDnsSideEffect } from '../../kernel/providers/side-effect-result.js'
import type { CloudflareZoneService } from '../../domains/cloudflare/cloudflare-zone.service.js'
import { DNSPOD_DEFAULT_LINE } from '../../domains/dnspod/dns-pod-record.service.js'
import type { DnsPodAccess } from '../../domains/dnspod/access.js'
import type { DnsPodZoneCatalog } from '../../domains/dnspod/zone-catalog.js'
import { zoneOwnsHostname } from '../../domains/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../domains/cloudflare/saas/saas-hostname.service.js'
import type { SaaSSyncConfigService } from '../../domains/cloudflare/saas/saas-sync-config.service.js'
import type { DnsWriter } from '../derived-records/dns-writer.js'
import { CloudflareDnsSaaSSyncAdapter } from './cloudflare-dns-saas-sync.adapter.js'
import { dnsZoneKey } from '../../kernel/jobs/job-types.js'
import { DNSPOD_PREFERRED_LINE, DnsPodSaaSSyncAdapter } from './dns-pod-saas-sync.adapter.js'
import {
  cloudflareDnsCleanupRecipe,
  dnspodSaaSCleanupRecipe,
  type SaaSSyncProviderType,
  type SaaSSyncRecord,
  type SyncCollectedRecords,
} from '../derived-records/planners/saas.planner.js'
import type { SaaSSyncAdapter } from './saas-sync-records.js'

/** SaaS DNS 同步调度：按主机名生效配置选择 DNSPod / Cloudflare DNS 适配器 */
export class SaaSDnsSyncCoordinator {
  private readonly dnspod: SaaSSyncAdapter
  private readonly cloudflareDns: SaaSSyncAdapter

  constructor(
    private readonly hostnames: SaaSHostnameService,
    syncConfigs: SaaSSyncConfigService,
    private readonly access: DnsPodAccess,
    private readonly catalog: DnsPodZoneCatalog,
    cloudflareZones: CloudflareZoneService,
    writer: DnsWriter
  ) {
    this.dnspod = new DnsPodSaaSSyncAdapter(hostnames, access, catalog, writer)
    this.cloudflareDns = new CloudflareDnsSaaSSyncAdapter(hostnames, syncConfigs, cloudflareZones, writer)
  }

  /** 创建前预检同步目标 */
  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}) {
    const target = String(data.sync_target ?? '').trim() || (await this.hostnames.defaultSyncTarget(providerId))
    return this.adapterFor(target).preflight(providerId, hostnameFqdn, data)
  }

  async sync(providerId: string, zoneName: string, hostnameFqdn: string) {
    const adapter = await this.adapterForHostname(providerId, zoneName, hostnameFqdn)
    return runDnsSideEffect(() => adapter.sync(providerId, zoneName, hostnameFqdn))
  }

  async resync(providerId: string, zoneName: string, hostnameFqdn: string, beforeRecords: SaaSSyncRecord[]) {
    const adapter = await this.adapterForHostname(providerId, zoneName, hostnameFqdn)
    return runDnsSideEffect(() => adapter.resyncAfterUpdate(providerId, zoneName, hostnameFqdn, beforeRecords))
  }

  async cleanupStale(providerId: string, zoneName: string, hostnameFqdn: string) {
    const adapter = await this.adapterForHostname(providerId, zoneName, hostnameFqdn)
    return runDnsSideEffect(() => adapter.cleanupStaleRecords(providerId, zoneName, hostnameFqdn))
  }

  /** 清理不要求 Cloudflare 主机名仍存在（删除流程先删主机名再清 DNS） */
  async cleanup(providerId: string, zoneName: string, hostnameFqdn: string, records: SaaSSyncRecord[]) {
    return runDnsSideEffect(async () => {
      const configured = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName).catch(() => null)
      const fallback = configured?.sync_target || (await this.hostnames.defaultSyncTarget(providerId).catch(() => ''))
      const providerType: SaaSSyncProviderType =
        records.find((record) => record.provider_type)?.provider_type ??
        (fallback === 'cloudflare_dns' ? 'cloudflare' : 'dnspod')
      return this.adapterForProvider(providerType).cleanup(providerId, hostnameFqdn, records)
    })
  }

  /** 收集当前记录快照；主机名已被删除时按本地偏好重建清理配方 */
  async collect(providerId: string, zoneName: string, hostnameFqdn: string): Promise<SyncCollectedRecords> {
    try {
      const adapter = await this.adapterForHostname(providerId, zoneName, hostnameFqdn)
      return await adapter.collectRecordsFor(providerId, zoneName, hostnameFqdn)
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'saas_hostname_not_found')) throw error
      return this.fallbackRecipe(providerId, hostnameFqdn)
    }
  }

  /**
   * 该 SaaS 任务会写入的底层 DNS 目标：关联的 Cloudflare DNS 与 DNSPod 服务商 + 站点。
   * 用于跨工作流互斥（与 DNS 批量、EdgeOne 批量共享同一资源）。
   */
  async resourceKeys(providerId: string, zoneName: string): Promise<string[]> {
    const zone = zoneName.trim().toLowerCase()
    const keys: string[] = []
    const cloudflareId = await this.hostnames.cloudflareProviderId(providerId).catch(() => '')
    if (cloudflareId) keys.push(dnsZoneKey('cloudflare', cloudflareId, zone))
    const dnspodId = await this.access.linkedProviderId(providerId, 'saas', 'SaaS').catch(() => '')
    if (dnspodId) keys.push(dnsZoneKey('dnspod', dnspodId, zone))
    return keys
  }

  /** 外部配置里的同步目标取值（cloudflare_dns / dnspod） */
  private adapterFor(target: string): SaaSSyncAdapter {
    return target === 'cloudflare_dns' ? this.cloudflareDns : this.dnspod
  }

  /** 记录自带的厂商类型 → 适配器 */
  private adapterForProvider(type: SaaSSyncProviderType): SaaSSyncAdapter {
    return type === 'cloudflare' ? this.cloudflareDns : this.dnspod
  }

  private async adapterForHostname(providerId: string, zoneName: string, hostnameFqdn: string) {
    const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName)
    return this.adapterFor(config.sync_target)
  }

  /** 主机名已删除时的清理配方：值为空，按 名称+类型(+线路)+备注 删除 */
  private async fallbackRecipe(providerId: string, hostnameFqdn: string): Promise<SyncCollectedRecords> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    const empty = { hostname_fqdn: fqdn, records: [] }
    if (fqdn === '') return empty

    const config = await this.hostnames.effectiveSyncConfig(providerId, fqdn).catch(() => null)
    const target = config?.sync_target || (await this.hostnames.defaultSyncTarget(providerId))

    if (target === 'cloudflare_dns') {
      const zone = config?.sync_zone ?? ''
      const provider =
        config?.sync_provider_id || (await this.hostnames.cloudflareProviderId(providerId).catch(() => ''))
      if (!provider || !zone || !zoneOwnsHostname(zone, fqdn)) return empty
      return { hostname_fqdn: fqdn, records: cloudflareDnsCleanupRecipe(fqdn, provider, zone) }
    }

    try {
      const dnspodProviderId =
        config?.sync_provider_id || (await this.access.requireLinkedProviderId(providerId, 'saas', 'SaaS'))
      const dnspodZone = config?.sync_zone
        ? await this.catalog.requireExplicit(dnspodProviderId, config.sync_zone, 'saas')
        : await this.catalog.resolve(dnspodProviderId, fqdn, 'saas')
      return {
        hostname_fqdn: fqdn,
        records: dnspodSaaSCleanupRecipe(fqdn, dnspodProviderId, dnspodZone, {
          default: DNSPOD_DEFAULT_LINE,
          preferred: DNSPOD_PREFERRED_LINE,
        }),
      }
    } catch {
      // 关联或域名已不可用：无可清理记录
      return empty
    }
  }
}
