import { ProviderRepository } from '../../../repositories/provider-repository.js'
import { ApiError } from '../../../support/api-error.js'
import type { SaasProvider } from '../../../types/provider.js'
import { CloudflareDnsRecordService, type RecordPayload } from '../../cloudflare/cloudflare-dns-record-service.js'
import { CloudflareZoneService } from '../../cloudflare/cloudflare-zone-service.js'
import { SaasHostnameService } from '../saas-hostname-service.js'
import { isHostnameActive } from '../utils/host-status.js'
import type { SyncDriver } from './sync-driver.js'

export class CloudflareDnsSyncDriver implements SyncDriver {
  private readonly purposeLabels: Record<string, string> = {
    origin_cname: '业务接入',
    ownership_verification: '所有权验证',
    dcv_delegation: 'DCV 委派',
  }

  constructor(
    private readonly providers: ProviderRepository,
    private readonly hostnames: SaasHostnameService,
    private readonly zones: CloudflareZoneService,
    private readonly records: CloudflareDnsRecordService
  ) {}

  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, hostnameFqdn, String(data.sync_zone ?? ''))
    return { cloudflare_provider_id: cloudflareProviderId, cloudflare_zone_id: zoneId, cloudflare_zone: zoneName, hostname_fqdn: hostnameFqdn.trim() }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, hostnameFqdn)
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = this.requireFqdn(hostname)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(hostname, effectiveOrigin)

    const records = this.collectRecords(hostname, effectiveOrigin, zoneName, cloudflareProviderId)
    if (records.length === 0) throw new ApiError('saas_no_sync_records', 'No records available for sync', 422)

    const results = await Promise.all(records.map((record) => this.withPurpose(record, this.syncRecord(cloudflareProviderId, zoneId, record))))
    return { hostname_fqdn: fqdn, hostname: fqdn, cloudflare_provider_id: cloudflareProviderId, cloudflare_zone: zoneName, records: results }
  }

  async resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: Array<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = this.requireFqdn(hostname)
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, fqdn)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(hostname, effectiveOrigin)

    const afterRecords = this.collectRecords(hostname, effectiveOrigin, zoneName, cloudflareProviderId)
    const deleted = await this.deleteMissingRecords(cloudflareProviderId, zoneId, beforeRecords, afterRecords)
    const results = await Promise.all(afterRecords.map((record) => this.withPurpose(record, this.syncRecord(cloudflareProviderId, zoneId, record))))

    return {
      hostname_fqdn: fqdn,
      cloudflare_zone: zoneName,
      cleaned: deleted.filter((r) => r.status === 'deleted').length,
      deleted,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
    if (records.length === 0 || hostnameFqdn === '') return { cleaned: 0, records: [] }

    let cloudflareProviderId = String(records[0]?.provider_id ?? '').trim()
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)
    const zoneName = String(records[0]?.zone_name ?? '').trim()
    if (zoneName === '') return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }

    let zoneId = ''
    try {
      zoneId = await this.zones.idByName(cloudflareProviderId, zoneName)
    } catch {
      return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }
    }

      const results = await Promise.all(records.map((record) => this.withPurpose(record, this.deleteRecord(cloudflareProviderId, zoneId, record))))
    return { cleaned: results.filter((r) => r.status === 'deleted').length, cloudflare_zone: zoneName, records: results }
  }

  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }

    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') return { cleaned: 0, reason: 'fqdn_missing' }

    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, fqdn)
    const ownership = (hostname.ownership_verification as Record<string, unknown>) ?? {}
    const record = this.record('TXT', `_cf-custom-hostname.${fqdn}`, String(ownership.value ?? ''), 'ownership_verification', fqdn, zoneName, cloudflareProviderId)
    const result = await this.deleteRecord(cloudflareProviderId, zoneId, record)

    return { cleaned: result.status === 'deleted' ? 1 : 0, cloudflare_zone: zoneName, records: [result] }
  }

  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const sync = await this.hostnames.syncConfig(providerId, String(hostname.hostname ?? ''), cfZoneName)
    let cloudflareProviderId = String(sync.sync_provider_id ?? '').trim()
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)
    const zoneName = String(sync.sync_zone ?? '').trim()

    return {
      hostname_fqdn: String(hostname.hostname ?? ''),
      records: this.collectRecords(hostname, await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname), zoneName, cloudflareProviderId, true),
    }
  }

  private async resolveTarget(providerId: string, hostnameFqdn: string, explicitSyncZone = '', explicitSyncProviderId = ''): Promise<[string, string, string]> {
    let cloudflareProviderId = explicitSyncProviderId.trim()
    if (cloudflareProviderId === '') {
      const sync = await this.hostnames.syncConfig(providerId, hostnameFqdn)
      cloudflareProviderId = String(sync.sync_provider_id ?? '').trim()
    }
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)

    let zoneName = explicitSyncZone.toLowerCase().trim()
    if (zoneName === '') {
      const sync = await this.hostnames.syncConfig(providerId, hostnameFqdn)
      zoneName = String(sync.sync_zone ?? '').toLowerCase().trim()
    }
    if (zoneName === '') throw new ApiError('saas_cloudflare_sync_zone_missing', 'Cloudflare DNS sync zone is required', 422)

    const zoneId = await this.zones.idByName(cloudflareProviderId, zoneName)
    return [cloudflareProviderId, zoneId, zoneName]
  }

  private async requireCloudflareDnsProviderId(providerId: string): Promise<string> {
    const provider = await this.providers.requireType<SaasProvider>(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')
    const cloudflareDns = provider.cloudflare_dns_provider ?? ''
    if (cloudflareDns !== '') return cloudflareDns
    if (provider.cloudflare_provider !== '') return provider.cloudflare_provider
    throw new ApiError('saas_cloudflare_dns_provider_missing', 'SaaS provider is not linked to a Cloudflare DNS provider', 422)
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

  private requireBusinessTarget(hostname: Record<string, unknown>, effectiveOrigin: string): void {
    const autoPreferred = Boolean(hostname.auto_preferred ?? false)
    const metadata = (hostname.custom_metadata as Record<string, unknown> | null) ?? {}
    const preferred = String(metadata.preferred_domain ?? '').trim()
    const businessTarget = autoPreferred && preferred !== '' ? preferred : effectiveOrigin
    if (businessTarget === '') throw new ApiError('saas_business_target_missing', 'No business CNAME target available', 422)
  }

  private collectRecords(hostname: Record<string, unknown>, effectiveOrigin: string, zoneName: string, cloudflareProviderId: string, includeAll = false): Array<Record<string, unknown>> {
    const records: Array<Record<string, unknown>> = []
    const fqdn = String(hostname.hostname ?? '')
    const shouldOutputOwnership = includeAll || !isHostnameActive(hostname)
    const autoPreferred = Boolean(hostname.auto_preferred ?? false)
    const metadata = (hostname.custom_metadata as Record<string, unknown> | null) ?? {}
    const preferred = String(metadata.preferred_domain ?? '').trim()
    const businessTarget = autoPreferred && preferred !== '' ? preferred : effectiveOrigin

    if (fqdn !== '' && businessTarget !== '') {
      records.push(this.record('CNAME', fqdn, businessTarget, 'origin_cname', fqdn, zoneName, cloudflareProviderId))
    }

    const ssl = (hostname.ssl as Record<string, unknown>) ?? {}
    const dcvRecords = Array.isArray(ssl.dcv_delegation_records) ? ssl.dcv_delegation_records : []
    let dcvAdded = false
    for (const rec of dcvRecords) {
      if (typeof rec !== 'object' || rec === null) continue
      const cname = String((rec as Record<string, unknown>).cname ?? '')
      const target = String((rec as Record<string, unknown>).cname_target ?? '')
      if (cname !== '' && target !== '') {
        records.push(this.record('CNAME', cname, target, 'dcv_delegation', fqdn, zoneName, cloudflareProviderId))
        dcvAdded = true
      }
    }

    if (!dcvAdded && fqdn !== '') {
      const uuid = String(ssl.dcv_delegation_uuid ?? '').trim()
      if (uuid !== '') {
        records.push(this.record('CNAME', `_acme-challenge.${fqdn}`, `${fqdn}.${uuid}.dcv.cloudflare.com`, 'dcv_delegation', fqdn, zoneName, cloudflareProviderId))
      }
    }

    if (shouldOutputOwnership) {
      const ownership = (hostname.ownership_verification as Record<string, unknown>) ?? null
      if (ownership && ownership.name && ownership.value) {
        records.push(this.record('TXT', String(ownership.name), String(ownership.value), 'ownership_verification', fqdn, zoneName, cloudflareProviderId))
      }
    }

    return records
  }

  private record(type: string, name: string, value: string, purpose: string, fqdn: string, zoneName: string, cloudflareProviderId: string): Record<string, unknown> {
    return {
      type,
      name,
      value,
      purpose,
      provider_id: cloudflareProviderId,
      zone_name: zoneName,
      comment: `${this.purposeLabels[purpose] ?? '自定义主机名'}丨${fqdn}`,
    }
  }

  private async withPurpose(record: Record<string, unknown>, resultPromise: Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const result = await resultPromise
    return { purpose: record.purpose, ...result }
  }

  private async syncRecord(cloudflareProviderId: string, zoneId: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name, value: record.value }
    const matches = await this.exactMatches(cloudflareProviderId, zoneId, String(record.name), String(record.type))
    const expectedValue = String(record.value ?? '').replace(/\.$/, '')
    const expectedComment = String(record.comment ?? '')

    for (const match of matches) {
      const value = String(match.content ?? '').replace(/\.$/, '')
      if (value === expectedValue) {
        const comment = String(match.comment ?? '')
        if (comment === expectedComment || comment === '') {
          return { ...base, status: 'unchanged', record_id: String(match.id ?? '') }
        }
      }
    }

    for (const match of matches) {
      if (String(match.comment ?? '') !== expectedComment) continue
      const updated = await this.records.update(cloudflareProviderId, zoneId, String(match.id), this.recordPayload(record))
      return { ...base, status: 'updated', record_id: String(updated.id ?? match.id ?? '') }
    }

    if (matches.length > 0) {
      throw new ApiError('cloudflare_dns_record_conflict', 'Cloudflare DNS record conflict', 409, { name: record.name, type: record.type })
    }

    const created = await this.records.create(cloudflareProviderId, zoneId, this.recordPayload(record))
    return { ...base, status: 'created', record_id: String(created.id ?? '') }
  }

  private async deleteRecord(cloudflareProviderId: string, zoneId: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name }
    const expectedValue = String(record.value ?? '').replace(/\.$/, '')
    const expectedComment = String(record.comment ?? '')

    for (const match of await this.exactMatches(cloudflareProviderId, zoneId, String(record.name), String(record.type))) {
      const value = String(match.content ?? '').replace(/\.$/, '')
      if (value !== expectedValue) continue
      const comment = String(match.comment ?? '')
      if (comment !== '' && comment !== expectedComment) continue
      const recordId = String(match.id ?? '')
      if (recordId === '') continue
      await this.records.delete(cloudflareProviderId, zoneId, recordId)
      return { ...base, status: 'deleted', record_id: recordId }
    }

    return { ...base, status: 'not_found', record_id: '' }
  }

  private async exactMatches(cloudflareProviderId: string, zoneId: string, fqdn: string, type: string): Promise<Array<Record<string, unknown>>> {
    const matches: Array<Record<string, unknown>> = []
    let page = 1
    let totalPages = 1

    do {
      const result = await this.records.list(cloudflareProviderId, zoneId, { type, search: fqdn, page, per_page: 100 })
      for (const record of result.items) {
        if (String(record.name ?? '') === fqdn && String(record.type ?? '') === type) {
          matches.push(record)
        }
      }
      totalPages = Number(result.pagination.total_pages ?? result.pagination.total_count ?? 1)
      page++
    } while (page <= totalPages)

    return matches
  }

  private recordPayload(record: Record<string, unknown>): RecordPayload {
    return {
      type: String(record.type),
      name: String(record.name),
      content: String(record.value),
      ttl: 1,
      comment: String(record.comment ?? ''),
      proxied: false,
    }
  }

  private async deleteMissingRecords(
    cloudflareProviderId: string,
    zoneId: string,
    beforeRecords: Array<Record<string, unknown>>,
    afterRecords: Array<Record<string, unknown>>
  ): Promise<Array<Record<string, unknown>>> {
    const afterMap = new Set(afterRecords.map((record) => this.recordSignature(record)))
    const deleted: Array<Record<string, unknown>> = []
    const seen = new Set<string>()

    for (const record of beforeRecords) {
      const signature = this.recordSignature(record)
      if (signature === '' || seen.has(signature) || afterMap.has(signature)) continue
      seen.add(signature)
      deleted.push(await this.withPurpose(record, this.deleteRecord(cloudflareProviderId, zoneId, record)))
    }

    return deleted
  }

  private recordSignature(record: Record<string, unknown>): string {
    const type = String(record.type ?? '').toUpperCase().trim()
    const name = String(record.name ?? '').toLowerCase().replace(/\.$/, '').trim()
    const value = String(record.value ?? '').toLowerCase().replace(/\.$/, '').trim()
    if (type === '' || name === '' || value === '') return ''
    return [type, name, value].join('|')
  }
}
