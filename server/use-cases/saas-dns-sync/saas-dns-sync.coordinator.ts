import { ApiError } from '../../core/http/api-error.js'
import { normalizeFqdn } from '../../shared/values.js'
import { runDnsSideEffect } from '../../core/providers/side-effect-result.js'
import type { CloudflareZoneService } from '../../modules/cloudflare/cloudflare-zone.service.js'
import { DNSPOD_DEFAULT_LINE } from '../../modules/dnspod/dns-pod-record.service.js'
import type { DnsPodAccess } from '../../modules/dnspod/access.js'
import type { DnsPodZoneCatalog } from '../../modules/dnspod/zone-catalog.js'
import type { CloudflareCustomHostname } from '../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import { zoneOwnsHostname } from '../../modules/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../modules/cloudflare/saas/saas-hostname.service.js'
import type { SaaSSyncConfigService } from '../../modules/cloudflare/saas/saas-sync-config.service.js'
import type { DnsWriter } from '../derived-records/dns-writer.js'
import { CloudflareDnsSaaSSyncAdapter } from './cloudflare-dns-saas-sync.adapter.js'
import { dnsZoneKey } from '../../core/jobs/job-types.js'
import { DnsPodSaaSSyncAdapter } from './dns-pod-saas-sync.adapter.js'
import {
  DNSPOD_PREFERRED_LINE,
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
    private readonly syncConfigs: SaaSSyncConfigService,
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

  /** 主机名快照可由调用方传入，避免同一次对账重复强制读取上游 */
  async cleanupStale(providerId: string, zoneName: string, hostnameFqdn: string, hostname?: CloudflareCustomHostname) {
    const adapter = await this.adapterForHostname(providerId, zoneName, hostnameFqdn)
    return runDnsSideEffect(() => adapter.cleanupStaleRecords(providerId, zoneName, hostnameFqdn, hostname))
  }

  /**
   * 清理不要求 Cloudflare 主机名仍存在（删除流程先删主机名再清 DNS）。
   * 厂商由记录自带（清理配方与写入路径同源），不再按已删除主机名的生效配置回退解析。
   */
  async cleanup(providerId: string, _zoneName: string, hostnameFqdn: string, records: SaaSSyncRecord[]) {
    return runDnsSideEffect(() => {
      const providerType = records[0]?.provider_type
      if (!providerType) return Promise.resolve({ cleaned: 0, records: [] })
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
   * 该 SaaS 任务会写入的底层 DNS 目标键：主机名所在 Cloudflare 站点 + 各主机名生效配置解析出的
   * 写入目标（Cloudflare DNS / DNSPod）。用于跨工作流互斥（与 DNS 批量、EdgeOne 批量共享同一资源）。
   * 主机名清单缺省或单条配置无法解析时退回服务商级默认关联，避免互斥被静默放宽。
   */
  async resourceKeys(providerId: string, zoneName: string, hostnames: string[] = []): Promise<string[]> {
    const zone = zoneName.trim().toLowerCase()
    const keys = new Set<string>()
    const cloudflareId = await this.hostnames.cloudflareProviderId(providerId).catch(() => '')
    if (cloudflareId && zone) keys.add(dnsZoneKey('cloudflare', cloudflareId, zone))

    const dnspodId = await this.access.linkedProviderId(providerId, 'saas', 'SaaS').catch(() => '')
    const defaultCloudflareDnsId = await this.syncConfigs
      .defaultSyncProviderId(providerId, 'cloudflare_dns')
      .catch(() => '')
    const addFallbackKeys = () => {
      if (dnspodId && zone) keys.add(dnsZoneKey('dnspod', dnspodId, zone))
      const provider = defaultCloudflareDnsId || cloudflareId
      if (provider && zone) keys.add(dnsZoneKey('cloudflare', provider, zone))
    }

    const fqdns = [...new Set(hostnames.map((hostname) => normalizeFqdn(hostname)).filter(Boolean))]
    if (fqdns.length === 0) {
      addFallbackKeys()
      return [...keys]
    }

    for (const fqdn of fqdns) {
      const config = await this.hostnames.effectiveSyncConfig(providerId, fqdn, zone).catch(() => null)
      if (!config) {
        addFallbackKeys()
        continue
      }
      const explicitZone = String(config.sync_zone ?? '')
      const explicitProvider = String(config.sync_provider_id ?? '')
      if (config.sync_target === 'cloudflare_dns') {
        const provider = explicitProvider || defaultCloudflareDnsId || cloudflareId
        // 站点不覆盖主机名时与写入路径一致地回退到主机名所在站点
        const dnsZone = zoneOwnsHostname(explicitZone, fqdn) ? explicitZone : zone
        if (provider && dnsZone) keys.add(dnsZoneKey('cloudflare', provider, dnsZone))
        continue
      }
      if (config.sync_target !== 'dnspod' || !dnspodId) continue
      const provider = explicitProvider || dnspodId
      const dnsZone =
        (await this.existingDnsPodZone(provider, explicitZone)) ||
        (await this.catalog.match(provider, fqdn).catch(() => ''))
      if (dnsZone) keys.add(dnsZoneKey('dnspod', provider, dnsZone))
    }
    return [...keys]
  }

  /** 显式同步站点必须存在于账号内；旧版猜测值不存在时返回空串，交由最长后缀匹配 */
  private async existingDnsPodZone(providerId: string, zone: string): Promise<string> {
    if (zone === '') return ''
    return (await this.catalog.match(providerId, zone).catch(() => '')) === zone ? zone : ''
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
