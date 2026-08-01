import { ApiError } from '../../shared/http/api-error.js'
import type { DnsSideEffect } from '../../shared/providers/side-effect-result.js'
import { ProviderRepository } from '../../modules/providers/provider.repository.js'
import { CloudflareDnsRecordService } from '../../modules/cloudflare/cloudflare-dns-record.service.js'
import { CloudflareZoneService } from '../../modules/cloudflare/cloudflare-zone.service.js'
import { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'
import { CloudflareDnsSaaSDriver } from './cloudflare-dns-sync.adapter.js'
import { DnsPodSaaSDriver } from './dns-pod-sync.adapter.js'
import { DnsPodRecordOps } from '../../modules/dns-pod/dns-pod-record-sync.service.js'
import type { SyncDriver, SyncRecord } from './saas-dns-sync.types.js'
import { cloudflareDnsCleanupRecipe, dnspodSaaSCleanupRecipe } from './saas-dns-cleanup.js'
import { zoneOwnsHostname } from '../../modules/saas/saas-hostname.js'

/**
 * SaaS DNS sync coordinator.
 */
export class SaaSDnsSyncCoordinator {
  private dnspodDriverInstance: SyncDriver | null = null
  private cloudflareDnsDriverInstance: SyncDriver | null = null

  constructor(
    private readonly providers: ProviderRepository,
    private readonly hostnames: SaaSHostnameService,
    private readonly support: DnsPodRecordOps,
    private readonly cloudflareZones: CloudflareZoneService,
    private readonly cloudflareDns: CloudflareDnsRecordService
  ) {}

  driverForTarget(target: string): SyncDriver {
    return target === 'cloudflare_dns' ? this.cloudflareDnsDriver() : this.dnspodDriver()
  }

  async driverForSaaSInput(providerId: string, data: Record<string, unknown>): Promise<SyncDriver> {
    let target = String(data.sync_target ?? '').trim()
    if (target === '') target = await this.hostnames.defaultSyncTarget(providerId)
    return this.driverForTarget(target)
  }

  async driverForSaaSHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<SyncDriver> {
    const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName)
    const target = String(config.sync_target ?? '').trim()
    return this.driverForTarget(target)
  }

  async collectSaaSRecords(providerId: string, zoneName: string, hostnameFqdn: string) {
    try {
      const driver = await this.driverForSaaSHostname(providerId, zoneName, hostnameFqdn)
      return await driver.collectRecordsFor(providerId, zoneName, hostnameFqdn)
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'saas_hostname_not_found')) throw error
      // CF custom hostname is already gone: rebuild the cleanup set from durable local preference.
      return this.collectSaaSRecordsFallback(providerId, hostnameFqdn)
    }
  }

  /**
   * When CF hostname is already deleted, invent DNS cleanup set from local preference / defaults.
   * Record values are empty so deletes match by type+name(+line) only.
   */
  async collectSaaSRecordsFallback(
    providerId: string,
    hostnameFqdn: string
  ): Promise<{ hostname_fqdn: string; records: SyncRecord[] }> {
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    if (fqdn === '') return { hostname_fqdn: '', records: [] }

    const config = await this.resolveFallbackSyncConfig(providerId, fqdn)
    const target = String(config.sync_target ?? '').trim() || (await this.hostnames.defaultSyncTarget(providerId))

    if (target === 'cloudflare_dns') {
      return this.fallbackCloudflareDns(providerId, fqdn, config)
    }
    return this.fallbackDnsPod(providerId, fqdn, config)
  }

  private async resolveFallbackSyncConfig(providerId: string, fqdn: string): Promise<Record<string, unknown>> {
    try {
      return await this.hostnames.effectiveSyncConfig(providerId, fqdn, '')
    } catch {
      return {
        sync_target: await this.hostnames.defaultSyncTarget(providerId),
        sync_provider_id: '',
        sync_zone: '',
      }
    }
  }

  private async fallbackCloudflareDns(
    providerId: string,
    fqdn: string,
    config: Record<string, unknown>
  ): Promise<{ hostname_fqdn: string; records: SyncRecord[] }> {
    const zoneName = String(config.sync_zone ?? '')
      .trim()
      .toLowerCase()
    let provider = String(config.sync_provider_id ?? '').trim()
    if (provider === '') {
      try {
        provider = await this.hostnames.cloudflareProviderIdFor(providerId)
      } catch {
        provider = ''
      }
    }
    if (provider === '' || zoneName === '' || !zoneOwnsHostname(zoneName, fqdn)) {
      return { hostname_fqdn: fqdn, records: [] }
    }
    return {
      hostname_fqdn: fqdn,
      records: cloudflareDnsCleanupRecipe(fqdn, provider, zoneName),
    }
  }

  private async fallbackDnsPod(
    providerId: string,
    fqdn: string,
    config: Record<string, unknown>
  ): Promise<{ hostname_fqdn: string; records: SyncRecord[] }> {
    let dnspodProviderId = String(config.sync_provider_id ?? '').trim()
    if (dnspodProviderId === '') {
      try {
        dnspodProviderId = await this.support.requireDnsPodProviderId(providerId, 'saas', 'SaaS')
      } catch {
        return { hostname_fqdn: fqdn, records: [] }
      }
    }

    let dnspodZone = String(config.sync_zone ?? '')
      .trim()
      .toLowerCase()
    try {
      if (dnspodZone !== '') {
        dnspodZone = await this.support.requireExplicitDnsPodZone(dnspodProviderId, dnspodZone, 'saas')
      } else {
        dnspodZone = await this.support.resolveDnsPodZone(dnspodProviderId, fqdn, 'saas')
      }
    } catch {
      return { hostname_fqdn: fqdn, records: [] }
    }

    return {
      hostname_fqdn: fqdn,
      records: dnspodSaaSCleanupRecipe(fqdn, dnspodProviderId, dnspodZone),
    }
  }

  async cleanupSaaSRecords(providerId: string, zoneName: string, hostnameFqdn: string, records: SyncRecord[]) {
    // Must not require CF hostname still exists — delete flow removes CF first, then cleans DNS.
    const target = await this.targetForCleanup(providerId, zoneName, hostnameFqdn, records)
    const driver = this.driverForTarget(target)
    return this.safe(() => driver.cleanup(providerId, hostnameFqdn, records))
  }

  private async targetForCleanup(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    records: SyncRecord[]
  ): Promise<string> {
    if (records.some((r) => String(r.dnspod_zone ?? '').trim() !== '' || String(r.line ?? '').trim() !== '')) {
      return 'dnspod'
    }
    if (records.some((r) => String(r.zone_name ?? '').trim() !== '')) {
      return 'cloudflare_dns'
    }
    try {
      const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName)
      const target = String(config.sync_target ?? '').trim()
      if (target !== '') return target
    } catch {
      // ignore
    }
    return (await this.hostnames.defaultSyncTarget(providerId)) || 'dnspod'
  }

  async preflightSaaS(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}) {
    const driver = await this.driverForSaaSInput(providerId, data)
    return driver.preflight(providerId, hostnameFqdn, data)
  }

  async syncSaaSHostname(providerId: string, zoneName: string, hostnameFqdn: string) {
    const driver = await this.driverForSaaSHostname(providerId, zoneName, hostnameFqdn)
    return this.safe(() => driver.sync(providerId, zoneName, hostnameFqdn))
  }

  async resyncSaaSHostname(providerId: string, zoneName: string, hostnameFqdn: string, beforeRecords: SyncRecord[]) {
    const driver = await this.driverForSaaSHostname(providerId, zoneName, hostnameFqdn)
    return this.safe(() => driver.resyncAfterUpdate(providerId, zoneName, hostnameFqdn, beforeRecords))
  }

  async cleanupSaaSStaleRecords(providerId: string, zoneName: string, hostnameFqdn: string) {
    const driver = await this.driverForSaaSHostname(providerId, zoneName, hostnameFqdn)
    return this.safe(() => driver.cleanupStaleRecords(providerId, zoneName, hostnameFqdn))
  }

  normalizeSyncSideEffect(result: unknown, defaultMessage: string): DnsSideEffect {
    const r = (result ?? {}) as Record<string, unknown>
    let status = String(r.status ?? '')
    if (status === '') status = this.deriveSyncStatus(r)
    // Some adapters return nested record.status.
    const record = (r.record as Record<string, unknown>) ?? {}
    if (status === '' || status === 'completed') {
      const action = String(record.status ?? '')
      if (action === 'failed') status = 'failed'
      else if (action !== '') status = 'completed'
    }
    return {
      status: status as DnsSideEffect['status'],
      message: String(r.message ?? defaultMessage),
      details: [r],
    }
  }

  normalizeCleanupSideEffect(result: unknown, defaultMessage: string): DnsSideEffect {
    const r = (result ?? {}) as Record<string, unknown>
    // safe() failures must surface as failed (never collapse to skipped)
    if (r.status === 'failed' || String(r.code ?? '') === 'dns_sync_failed') {
      return {
        status: 'failed',
        message: String(r.message ?? (defaultMessage || 'DNS 清理失败')),
        details: [r],
      }
    }
    const cleaned = Number(r.cleaned ?? 0)
    const status = r.status === 'skipped' || r.reason ? 'skipped' : cleaned > 0 ? 'completed' : 'skipped'
    let message = String(r.message ?? '')
    if (message === '') {
      message =
        status === 'completed'
          ? defaultMessage
          : String(r.reason ?? '') !== ''
            ? 'DNS 清理已跳过'
            : '未找到需要清理的 DNS 记录'
    }
    return {
      status: status as DnsSideEffect['status'],
      message,
      details: [r],
    }
  }

  async safe<T>(fn: () => Promise<T>): Promise<T | Record<string, unknown>> {
    try {
      return await fn()
    } catch (error) {
      // Must be `failed` so callers (preferred apply / batch) can surface DNS write errors.
      // Historically this returned `skipped`, which made preferred-domain changes look successful
      // even when DNSPod/Cloudflare CNAME was not updated.
      return {
        status: 'failed',
        code: error instanceof ApiError ? error.code : 'dns_sync_failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private deriveSyncStatus(result: Record<string, unknown>): DnsSideEffect['status'] {
    const records = Array.isArray(result.records) ? result.records : []
    if (records.length === 0) {
      return String(result.reason ?? '') !== '' || String(result.code ?? '') !== '' ? 'skipped' : 'completed'
    }
    for (const record of records) {
      if (typeof record === 'object' && record !== null && (record as Record<string, unknown>).status === 'failed') {
        return 'failed'
      }
    }
    return 'completed'
  }

  private dnspodDriver(): SyncDriver {
    if (!this.dnspodDriverInstance) {
      this.dnspodDriverInstance = new DnsPodSaaSDriver(this.hostnames, this.support)
    }
    return this.dnspodDriverInstance
  }

  private cloudflareDnsDriver(): SyncDriver {
    if (!this.cloudflareDnsDriverInstance) {
      this.cloudflareDnsDriverInstance = new CloudflareDnsSaaSDriver(
        this.providers,
        this.hostnames,
        this.cloudflareZones,
        this.cloudflareDns
      )
    }
    return this.cloudflareDnsDriverInstance
  }
}
