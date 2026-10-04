import { ApiError } from '../../shared/http/api-error.js'
import { normalizeFqdn } from '../../shared/lib/values.js'
import { runDnsSideEffect } from '../../shared/providers/side-effect-result.js'
import type { CloudflareDnsRecordService } from '../../modules/cloudflare/cloudflare-dns-record.service.js'
import type { CloudflareZoneService } from '../../modules/cloudflare/cloudflare-zone.service.js'
import { DNSPOD_DEFAULT_LINE } from '../../modules/dns-pod/dns-pod-record.service.js'
import type { DnsPodRecordSyncService } from '../../modules/dns-pod/dns-pod-record-sync.service.js'
import { zoneOwnsHostname } from '../../modules/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'
import type { SaaSSyncConfigService } from '../../modules/saas/saas-sync-config.service.js'
import { CloudflareDnsSaaSSyncAdapter } from './cloudflare-dns-saas-sync.adapter.js'
import { dnsZoneKey } from '../../platform/jobs/job-types.js'
import { DNSPOD_PREFERRED_LINE, DnsPodSaaSSyncAdapter } from './dns-pod-saas-sync.adapter.js'
import {
  cloudflareDnsCleanupRecipe,
  dnspodSaaSCleanupRecipe,
  type SaaSSyncAdapter,
  type SyncCollectedRecords,
  type SyncRecord,
} from './saas-sync-records.js'

/** SaaS DNS 同步调度：按主机名生效配置选择 DNSPod / Cloudflare DNS 适配器 */
export class SaaSDnsSyncCoordinator {
  private readonly dnspod: SaaSSyncAdapter
  private readonly cloudflareDns: SaaSSyncAdapter

  constructor(
    private readonly hostnames: SaaSHostnameService,
    syncConfigs: SaaSSyncConfigService,
    private readonly dnspodRecords: DnsPodRecordSyncService,
    cloudflareZones: CloudflareZoneService,
    cloudflareRecords: CloudflareDnsRecordService
  ) {
    this.dnspod = new DnsPodSaaSSyncAdapter(hostnames, dnspodRecords)
    this.cloudflareDns = new CloudflareDnsSaaSSyncAdapter(hostnames, syncConfigs, cloudflareZones, cloudflareRecords)
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

  async resync(providerId: string, zoneName: string, hostnameFqdn: string, beforeRecords: SyncRecord[]) {
    const adapter = await this.adapterForHostname(providerId, zoneName, hostnameFqdn)
    return runDnsSideEffect(() => adapter.resyncAfterUpdate(providerId, zoneName, hostnameFqdn, beforeRecords))
  }

  async cleanupStale(providerId: string, zoneName: string, hostnameFqdn: string) {
    const adapter = await this.adapterForHostname(providerId, zoneName, hostnameFqdn)
    return runDnsSideEffect(() => adapter.cleanupStaleRecords(providerId, zoneName, hostnameFqdn))
  }

  /** 清理不要求 Cloudflare 主机名仍存在（删除流程先删主机名再清 DNS） */
  async cleanup(providerId: string, zoneName: string, hostnameFqdn: string, records: SyncRecord[]) {
    return runDnsSideEffect(async () => {
      const adapter = this.adapterFor(await this.cleanupTarget(providerId, zoneName, hostnameFqdn, records))
      return adapter.cleanup(providerId, hostnameFqdn, records)
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
    const dnspodId = await this.dnspodRecords.lookupDnsPodProviderId(providerId, 'saas', 'SaaS').catch(() => '')
    if (dnspodId) keys.push(dnsZoneKey('dnspod', dnspodId, zone))
    return keys
  }

  private adapterFor(target: string): SaaSSyncAdapter {
    return target === 'cloudflare_dns' ? this.cloudflareDns : this.dnspod
  }

  private async adapterForHostname(providerId: string, zoneName: string, hostnameFqdn: string) {
    const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName)
    return this.adapterFor(config.sync_target)
  }

  /** 由记录特征推断清理目标：DNSPod 记录带线路/域名，Cloudflare 记录带站点名 */
  private async cleanupTarget(providerId: string, zoneName: string, hostnameFqdn: string, records: SyncRecord[]) {
    if (records.some((r) => String(r.dnspod_zone ?? '').trim() || String(r.line ?? '').trim())) return 'dnspod'
    if (records.some((r) => String(r.zone_name ?? '').trim())) return 'cloudflare_dns'
    const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName).catch(() => null)
    return config?.sync_target || (await this.hostnames.defaultSyncTarget(providerId)) || 'dnspod'
  }

  /** 主机名已删除时的清理配方：值为空，按 名称+类型(+线路) 删除 */
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
        config?.sync_provider_id || (await this.dnspodRecords.requireDnsPodProviderId(providerId, 'saas', 'SaaS'))
      const dnspodZone = config?.sync_zone
        ? await this.dnspodRecords.requireExplicitDnsPodZone(dnspodProviderId, config.sync_zone, 'saas')
        : await this.dnspodRecords.resolveDnsPodZone(dnspodProviderId, fqdn, 'saas')
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
