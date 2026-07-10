import { ApiError } from '../../../support/api-error.js'
import { DnsPodSyncSupport, type DnsPodSyncRecord } from '../../concerns/dns-pod-sync-support.js'
import { SaasHostnameService } from '../saas-hostname-service.js'
import { isHostnameActive } from '../utils/host-status.js'
import type { SyncDriver } from './sync-driver.js'

export class DnspodSyncDriver implements SyncDriver {
  private readonly purposeLabels: Record<string, string> = {
    origin_cname: '默认回源',
    ownership_verification: '所有权验证',
    dcv_delegation: 'DCV 委派',
    preferred_cname: '优选域名',
  }
  private readonly preferredLine = '境内'
  private readonly defaultLine = '默认'

  constructor(
    private readonly hostnames: SaasHostnameService,
    private readonly support: DnsPodSyncSupport
  ) {}

  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    let dnspodProviderId = String(data.sync_provider_id ?? '').trim()
    if (dnspodProviderId === '') {
      dnspodProviderId = await this.support.requireDnspodProviderId(providerId, 'saas', 'SaaS')
    }
    const fqdn = hostnameFqdn.trim()
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)

    const dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn, String(data.sync_zone ?? ''))
    return { dnspod_provider_id: dnspodProviderId, dnspod_zone: dnspodZone, hostname_fqdn: fqdn }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = this.requireFqdn(hostname)
    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    const dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(effectiveOrigin)

    const records = this.collectRecords(hostname, effectiveOrigin, dnspodProviderId, dnspodZone)
    if (records.length === 0) {
      throw new ApiError('saas_no_sync_records', 'No records available for sync', 422)
    }

    const precleaned = await this.support.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
    const results = await Promise.all(records.map((record) => this.withPurpose(record, this.support.sync(dnspodProviderId, dnspodZone, record))))

    return { hostname_fqdn: fqdn, hostname: fqdn, dnspod_zone: dnspodZone, precleaned, records: results }
  }

  async resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: Array<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = this.requireFqdn(hostname)
    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    if (dnspodProviderId === '') return { cleaned: 0, records: [], deleted: [], reason: 'dnspod_provider_missing' }

    let dnspodZone = ''
    try {
      dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
    } catch {
      return { cleaned: 0, records: [], deleted: [], reason: 'dnspod_zone_not_found' }
    }

    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(effectiveOrigin)
    const afterRecords = this.collectRecords(hostname, effectiveOrigin, dnspodProviderId, dnspodZone)
    const deleted = await this.deleteMissingRecords(dnspodProviderId, dnspodZone, beforeRecords, afterRecords)
    const precleaned = afterRecords.length === 0 ? [] : await this.support.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
    const results = await Promise.all(afterRecords.map((record) => this.withPurpose(record, this.support.sync(dnspodProviderId, dnspodZone, record))))

    return {
      hostname: fqdn,
      dnspod_zone: dnspodZone,
      cleaned: deleted.filter((r) => r.status === 'deleted').length,
      deleted,
      precleaned,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
    if (records.length === 0 || hostnameFqdn === '') return { cleaned: 0, records: [] }

    const dnspodProviderId = String(records[0]?.provider_id ?? '').trim()
    if (dnspodProviderId === '') return { cleaned: 0, records: [] }

    let dnspodZone = String(records[0]?.dnspod_zone ?? '').trim()
    if (dnspodZone === '') {
      try {
        dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, hostnameFqdn)
      } catch {
        return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
      }
    }

    const results = await Promise.all(records.map((record) => this.withPurpose(record as DnsPodSyncRecord, this.support.delete(dnspodProviderId, dnspodZone, record as DnsPodSyncRecord))))
    return { cleaned: results.filter((r) => r.status === 'deleted').length, dnspod_zone: dnspodZone, records: results }
  }

  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }

    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') return { cleaned: 0, reason: 'fqdn_missing' }

    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    if (dnspodProviderId === '') return { cleaned: 0, reason: 'dnspod_provider_missing' }

    let dnspodZone = ''
    try {
      dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
    } catch {
      return { cleaned: 0, reason: 'dnspod_zone_not_found' }
    }

    const ownershipFqdn = `_cf-custom-hostname.${fqdn}`
    const deleted = await this.support.deleteRecordsByNameType(dnspodProviderId, dnspodZone, ownershipFqdn, 'TXT', this.defaultLine)
    return { cleaned: deleted.filter((r) => r.status === 'deleted').length, dnspod_zone: dnspodZone, records: deleted }
  }

  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    const fqdn = String(hostname.hostname ?? '')

    let dnspodZone = ''
    if (fqdn !== '' && dnspodProviderId !== '') {
      try {
        dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
      } catch {
        dnspodZone = ''
      }
    }

    return {
      hostname_fqdn: fqdn,
      records: this.collectRecords(hostname, await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname), dnspodProviderId, dnspodZone, true, true),
    }
  }

  private requireFqdn(hostname: Record<string, unknown>): string {
    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)
    return fqdn
  }

  private async resolveEffectiveOrigin(providerId: string, cfZoneName: string, hostname: Record<string, unknown>): Promise<string> {
    const custom = String(hostname.custom_origin_server ?? '').trim()
    if (custom !== '') return custom
    return (await this.hostnames.fallbackOrigin(providerId, cfZoneName)) ?? ''
  }

  private requireBusinessTarget(effectiveOrigin: string): void {
    if (effectiveOrigin.trim() === '') {
      throw new ApiError('saas_business_target_missing', 'No business CNAME target available', 422)
    }
  }

  private async resolveTargetZone(providerId: string, dnspodProviderId: string, fqdn: string, explicitSyncZone = ''): Promise<string> {
    if (explicitSyncZone !== '') {
      return this.support.requireExplicitDnspodZone(dnspodProviderId, explicitSyncZone, 'saas')
    }

    const sync = await this.hostnames.syncConfig(providerId, fqdn, '')
    const syncZone = String(sync.sync_zone ?? '').trim()
    if (syncZone !== '') {
      return this.support.requireExplicitDnspodZone(dnspodProviderId, syncZone, 'saas')
    }

    return this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'saas')
  }

  private async resolveDnspodProviderId(providerId: string, hostname: Record<string, unknown>): Promise<string> {
    const syncProviderId = String(hostname.sync_provider_id ?? '').trim()
    if (syncProviderId !== '') return syncProviderId
    return this.support.lookupDnspodProviderId(providerId, 'saas', 'SaaS')
  }

  private collectRecords(
    hostname: Record<string, unknown>,
    effectiveOrigin: string,
    dnspodProviderId: string,
    dnspodZone: string,
    includeAll = false,
    forceOwnershipName = false
  ): DnsPodSyncRecord[] {
    const records: DnsPodSyncRecord[] = []
    const fqdn = String(hostname.hostname ?? '')
    const shouldOutputOwnership = includeAll || !isHostnameActive(hostname)
    const autoPreferred = Boolean(hostname.auto_preferred ?? false)

    if (fqdn !== '' && effectiveOrigin !== '') {
      records.push(this.record('CNAME', fqdn, effectiveOrigin, 'origin_cname', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
    }

    const metadata = (hostname.custom_metadata as Record<string, unknown> | null) ?? {}
    const preferred = String(metadata.preferred_domain ?? '').trim()
    if (autoPreferred && fqdn !== '' && preferred !== '') {
      records.push(this.record('CNAME', fqdn, preferred, 'preferred_cname', fqdn, dnspodProviderId, this.preferredLine, dnspodZone))
    }

    const ssl = (hostname.ssl as Record<string, unknown>) ?? {}
    const dcvRecords = Array.isArray(ssl.dcv_delegation_records) ? ssl.dcv_delegation_records : []
    let dcvAdded = false
    for (const rec of dcvRecords) {
      if (typeof rec !== 'object' || rec === null) continue
      const cname = String((rec as Record<string, unknown>).cname ?? '')
      const target = String((rec as Record<string, unknown>).cname_target ?? '')
      if (cname !== '' && target !== '') {
        records.push(this.record('CNAME', cname, target, 'dcv_delegation', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
        dcvAdded = true
      }
    }

    if (!dcvAdded && fqdn !== '') {
      const uuid = String(ssl.dcv_delegation_uuid ?? '').trim()
      if (uuid !== '') {
        records.push(this.record('CNAME', `_acme-challenge.${fqdn}`, `${fqdn}.${uuid}.dcv.cloudflare.com`, 'dcv_delegation', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
      }
    }

    if (shouldOutputOwnership) {
      const ownership = (hostname.ownership_verification as Record<string, unknown>) ?? null
      if (ownership && ownership.name && ownership.value) {
        records.push(this.record('TXT', String(ownership.name), String(ownership.value), 'ownership_verification', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
      } else if (forceOwnershipName && fqdn !== '') {
        records.push(this.record('TXT', `_cf-custom-hostname.${fqdn}`, '', 'ownership_verification', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
      }
    }

    return records
  }

  private record(
    type: string,
    name: string,
    value: string,
    purpose: string,
    fqdn: string,
    dnspodProviderId: string,
    line: string,
    dnspodZone: string
  ): DnsPodSyncRecord {
    return {
      type,
      name,
      value,
      line,
      purpose,
      provider_id: dnspodProviderId,
      dnspod_zone: dnspodZone,
      remark: `${this.purposeLabels[purpose] ?? '自定义主机名'}丨${fqdn}`,
    }
  }

  private async withPurpose(record: DnsPodSyncRecord, resultPromise: Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const result = await resultPromise
    return { purpose: record.purpose, ...result }
  }

  private async deleteMissingRecords(
    dnspodProviderId: string,
    dnspodZone: string,
    beforeRecords: Array<Record<string, unknown>>,
    afterRecords: DnsPodSyncRecord[]
  ): Promise<Array<Record<string, unknown>>> {
    const afterMap = new Set(afterRecords.map((record) => this.recordSignature(record)))
    const deleted: Array<Record<string, unknown>> = []
    const seen = new Set<string>()

    for (const record of beforeRecords) {
      const signature = this.recordSignature(record)
      if (signature === '' || seen.has(signature) || afterMap.has(signature)) continue
      seen.add(signature)
      deleted.push(await this.withPurpose(record as DnsPodSyncRecord, this.support.delete(dnspodProviderId, dnspodZone, record as DnsPodSyncRecord)))
    }

    return deleted
  }

  private recordSignature(record: Record<string, unknown>): string {
    const type = String(record.type ?? '').toUpperCase().trim()
    const name = String(record.name ?? '').toLowerCase().replace(/\.$/, '').trim()
    const value = String(record.value ?? '').toLowerCase().replace(/\.$/, '').trim()
    const line = String(record.line ?? this.defaultLine).trim()
    if (type === '' || name === '' || value === '') return ''
    return [type, name, value, line].join('|')
  }
}
