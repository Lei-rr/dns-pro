import { ApiError } from '../../../lib/http/api-error.js'
import type { DnsSideEffect } from '../../../lib/utils/side-effect-result.js'
import { ProviderRepository } from '../../provider/repository.js'
import { CloudflareDnsRecordService } from '../../cloudflare/services/dns-record-service.js'
import { CloudflareZoneService } from '../../cloudflare/services/zone-service.js'
import { SaasHostnameService } from '../../saas/services/hostname-service.js'
import { CloudflareDnsSaasDriver } from '../drivers/cloudflare-dns-saas-driver.js'
import { DnspodSaasDriver } from '../drivers/dnspod-saas-driver.js'
import { DnsPodRecordOps } from './dnspod-record-ops.js'
import type { SyncDriver, SyncRecord } from '../types.js'

/**
 * Unified DNS sync orchestrator.
 * SaaS / EdgeOne / future modules request sync through this service.
 */
export class SyncOrchestrator {
  constructor(
    private readonly providers: ProviderRepository = new ProviderRepository(),
    private readonly hostnames: SaasHostnameService = new SaasHostnameService(),
    private readonly support: DnsPodRecordOps = new DnsPodRecordOps(),
    private readonly cloudflareZones: CloudflareZoneService = new CloudflareZoneService(),
    private readonly cloudflareDns: CloudflareDnsRecordService = new CloudflareDnsRecordService(),
  ) {}

  driverForTarget(target: string): SyncDriver {
    return target === 'cloudflare_dns' ? this.cloudflareDnsDriver() : this.dnspodDriver()
  }

  async driverForSaasInput(providerId: string, data: Record<string, unknown>): Promise<SyncDriver> {
    let target = String(data.sync_target ?? '').trim()
    if (target === '') target = await this.hostnames.defaultSyncTarget(providerId)
    return this.driverForTarget(target)
  }

  async driverForSaasHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<SyncDriver> {
    const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName)
    const target = String(config.sync_target ?? '').trim()
    return this.driverForTarget(target)
  }

  async collectSaasRecords(providerId: string, zoneName: string, hostnameFqdn: string) {
    try {
      const driver = await this.driverForSaasHostname(providerId, zoneName, hostnameFqdn)
      return await driver.collectRecordsFor(providerId, zoneName, hostnameFqdn)
    } catch {
      // CF custom hostname may already be gone; still build DNS cleanup list from local preference.
      return this.collectSaasRecordsFallback(providerId, hostnameFqdn)
    }
  }

  /**
   * When CF hostname is already deleted, invent the usual DNS cleanup set from local preference / defaults.
   * Values are empty so DNSPod delete matches by type+name(+line) only.
   */
  async collectSaasRecordsFallback(providerId: string, hostnameFqdn: string): Promise<{ hostname_fqdn: string; records: SyncRecord[] }> {
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    if (fqdn === '') return { hostname_fqdn: '', records: [] }

    let config: Record<string, unknown> = {}
    try {
      config = await this.hostnames.effectiveSyncConfig(providerId, fqdn, '')
    } catch {
      config = {
        sync_target: await this.hostnames.defaultSyncTarget(providerId),
        sync_provider_id: '',
        sync_zone: '',
      }
    }
    const target = String(config.sync_target ?? '').trim() || (await this.hostnames.defaultSyncTarget(providerId))
    if (target !== 'dnspod') {
      // Cloudflare DNS fallback: zone must match FQDN; only clean common names when zone known.
      const zoneName = String(config.sync_zone ?? '').trim().toLowerCase()
      let provider = String(config.sync_provider_id ?? '').trim()
      if (provider === '') {
        try {
          provider = await this.hostnames.cloudflareProviderIdFor(providerId)
        } catch {
          provider = ''
        }
      }
      if (provider === '' || zoneName === '' || (fqdn !== zoneName && !fqdn.endsWith('.' + zoneName))) {
        return { hostname_fqdn: fqdn, records: [] }
      }
      return {
        hostname_fqdn: fqdn,
        records: [
          { type: 'CNAME', name: fqdn, value: '', purpose: 'origin_cname', provider_id: provider, zone_name: zoneName },
          { type: 'CNAME', name: `_acme-challenge.${fqdn}`, value: '', purpose: 'dcv_delegation', provider_id: provider, zone_name: zoneName },
          { type: 'TXT', name: `_cf-custom-hostname.${fqdn}`, value: '', purpose: 'ownership_verification', provider_id: provider, zone_name: zoneName },
        ],
      }
    }

    let dnspodProviderId = String(config.sync_provider_id ?? '').trim()
    if (dnspodProviderId === '') {
      try {
        dnspodProviderId = await this.support.requireDnspodProviderId(providerId, 'saas', 'SaaS')
      } catch {
        return { hostname_fqdn: fqdn, records: [] }
      }
    }

    let dnspodZone = String(config.sync_zone ?? '').trim().toLowerCase()
    try {
      if (dnspodZone !== '') {
        dnspodZone = await this.support.requireExplicitDnspodZone(dnspodProviderId, dnspodZone, 'saas')
      } else {
        dnspodZone = await this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'saas')
      }
    } catch {
      return { hostname_fqdn: fqdn, records: [] }
    }

    const records: SyncRecord[] = [
      { type: 'CNAME', name: fqdn, value: '', purpose: 'origin_cname', provider_id: dnspodProviderId, line: '默认', dnspod_zone: dnspodZone },
      { type: 'CNAME', name: fqdn, value: '', purpose: 'preferred_cname', provider_id: dnspodProviderId, line: '境内', dnspod_zone: dnspodZone },
      { type: 'CNAME', name: `_acme-challenge.${fqdn}`, value: '', purpose: 'dcv_delegation', provider_id: dnspodProviderId, line: '默认', dnspod_zone: dnspodZone },
      { type: 'TXT', name: `_cf-custom-hostname.${fqdn}`, value: '', purpose: 'ownership_verification', provider_id: dnspodProviderId, line: '默认', dnspod_zone: dnspodZone },
    ]
    return { hostname_fqdn: fqdn, records }
  }

  async cleanupSaasRecords(providerId: string, zoneName: string, hostnameFqdn: string, records: SyncRecord[]) {
    // Must not require CF hostname still exists — delete flow removes CF first, then cleans DNS.
    const target = await this.targetForCleanup(providerId, zoneName, hostnameFqdn, records)
    const driver = this.driverForTarget(target)
    return this.safe(() => driver.cleanup(providerId, hostnameFqdn, records))
  }

  private async targetForCleanup(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    records: SyncRecord[],
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

  async preflightSaas(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}) {
    const driver = await this.driverForSaasInput(providerId, data)
    return driver.preflight(providerId, hostnameFqdn, data)
  }

  async syncSaasHostname(providerId: string, zoneName: string, hostnameFqdn: string) {
    const driver = await this.driverForSaasHostname(providerId, zoneName, hostnameFqdn)
    return this.safe(() => driver.sync(providerId, zoneName, hostnameFqdn))
  }

  async resyncSaasHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    beforeRecords: SyncRecord[],
  ) {
    const driver = await this.driverForSaasHostname(providerId, zoneName, hostnameFqdn)
    return this.safe(() => driver.resyncAfterUpdate(providerId, zoneName, hostnameFqdn, beforeRecords))
  }

  async cleanupSaasStaleRecords(providerId: string, zoneName: string, hostnameFqdn: string) {
    const driver = await this.driverForSaasHostname(providerId, zoneName, hostnameFqdn)
    return this.safe(() => driver.cleanupStaleRecords(providerId, zoneName, hostnameFqdn))
  }

  /** EdgeOne: upsert default-line CNAME on linked DNSPod. */
  async syncEdgeOneCname(edgeoneProviderId: string, domainName: string, cname: string) {
    return this.safe(async () => {
      const dnspodProviderId = await this.support.requireDnspodProviderId(edgeoneProviderId, 'edgeone', 'EdgeOne')
      const fqdn = domainName.toLowerCase().trim()
      const dnspodZone = await this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'edgeone')
      if (cname === '') throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME is empty', 422)

      const record = {
        type: 'CNAME',
        name: fqdn,
        value: cname,
        line: '默认',
        purpose: 'edgeone_cname',
        provider_id: dnspodProviderId,
        remark: `EdgeOne 加速丨${fqdn}`,
      }
      const precleaned = await this.support.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
      const result = await this.support.sync(dnspodProviderId, dnspodZone, record)
      return { domain_name: fqdn, dnspod_zone: dnspodZone, precleaned, record: result }
    })
  }

  /** EdgeOne: delete default-line CNAME on linked DNSPod. */
  async cleanupEdgeOneCname(edgeoneProviderId: string, domainName: string, cname = '') {
    return this.safe(async () => {
      const dnspodProviderId = await this.support.lookupDnspodProviderId(edgeoneProviderId, 'edgeone', 'EdgeOne')
      if (dnspodProviderId === '') return { cleaned: 0, records: [], reason: 'dnspod_provider_missing' }

      const fqdn = domainName.toLowerCase().trim()
      let dnspodZone = ''
      try {
        dnspodZone = await this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'edgeone')
      } catch {
        return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
      }

      if (cname !== '') {
        const record = {
          type: 'CNAME',
          name: fqdn,
          value: cname,
          line: '默认',
          purpose: 'edgeone_cname',
          provider_id: dnspodProviderId,
          remark: `EdgeOne 加速丨${fqdn}`,
        }
        const result = await this.support.delete(dnspodProviderId, dnspodZone, record)
        return { cleaned: result.status === 'deleted' ? 1 : 0, dnspod_zone: dnspodZone, records: [result] }
      }

      const results = await this.support.deleteRecordsByNameType(dnspodProviderId, dnspodZone, fqdn, 'CNAME', '默认')
      return {
        cleaned: results.filter((r) => r.status === 'deleted').length,
        dnspod_zone: dnspodZone,
        records: results,
      }
    })
  }

  async preflightEdgeOne(edgeoneProviderId: string, domainName: string) {
    const dnspodProviderId = await this.support.requireDnspodProviderId(edgeoneProviderId, 'edgeone', 'EdgeOne')
    const fqdn = domainName.toLowerCase().trim()
    if (fqdn === '') throw new ApiError('validation_failed', 'Domain name is required', 422)
    const dnspodZone = await this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'edgeone')
    return { dnspod_provider_id: dnspodProviderId, dnspod_zone: dnspodZone, domain_name: fqdn }
  }

  normalizeSyncSideEffect(result: unknown, defaultMessage: string): DnsSideEffect {
    const r = (result ?? {}) as Record<string, unknown>
    let status = String(r.status ?? '')
    if (status === '') status = this.deriveSyncStatus(r)
    // EdgeOne style nested record.status
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
    return new DnspodSaasDriver(this.hostnames, this.support)
  }

  private cloudflareDnsDriver(): SyncDriver {
    return new CloudflareDnsSaasDriver(this.providers, this.hostnames, this.cloudflareZones, this.cloudflareDns)
  }
}
