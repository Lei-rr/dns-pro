import { ProviderRepository } from '../../modules/providers/provider.repository.js'
import { ApiError } from '../../shared/http/api-error.js'
import type { SaaSProvider } from '../../modules/providers/provider.types.js'
import type { CloudflareCustomHostname } from '../../modules/saas/saas-custom-hostname.client.js'
import {
  CloudflareDnsRecordService,
  type RecordPayload,
} from '../../modules/cloudflare/cloudflare-dns-record.service.js'
import { CloudflareZoneService } from '../../modules/cloudflare/cloudflare-zone.service.js'
import { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'
import { isHostnameActive } from '../../modules/saas/saas-host-status.js'
import type { SyncDriver, SyncRecord } from './saas-dns-sync.types.js'
import { deleteRemovedSyncRecords, syncRecordIdentity, withSyncPurpose } from './record-reconciliation.js'

export interface CloudflareDnsSyncRecord extends SyncRecord {
  zone_name?: string
  comment?: string
}

export class CloudflareDnsSaaSDriver implements SyncDriver {
  private readonly purposeLabels: Record<string, string> = {
    origin_cname: '业务接入',
    ownership_verification: '所有权验证',
    dcv_delegation: 'DCV 委派',
  }

  constructor(
    private readonly providers: ProviderRepository,
    private readonly hostnames: SaaSHostnameService,
    private readonly zones: CloudflareZoneService,
    private readonly records: CloudflareDnsRecordService
  ) {}

  async preflight(
    providerId: string,
    hostnameFqdn: string,
    data: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    // Create-time preflight must not look up SaaS hostname preferences — hostname is not created yet.
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(
      providerId,
      hostnameFqdn,
      String(data.sync_zone ?? ''),
      String(data.sync_provider_id ?? ''),
      true
    )
    return {
      cloudflare_provider_id: cloudflareProviderId,
      cloudflare_zone_id: zoneId,
      cloudflare_zone: zoneName,
      hostname_fqdn: hostnameFqdn.trim(),
    }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, hostnameFqdn)
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = this.requireFqdn(hostname)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(hostname, effectiveOrigin)

    const records = this.collectRecords(hostname, effectiveOrigin, zoneName, cloudflareProviderId)
    if (records.length === 0) throw new ApiError('saas_no_sync_records', 'No records available for sync', 422)

    const results = await Promise.all(
      records.map((record) => withSyncPurpose(record, this.syncRecord(cloudflareProviderId, zoneId, record)))
    )
    return {
      hostname_fqdn: fqdn,
      hostname: fqdn,
      cloudflare_provider_id: cloudflareProviderId,
      cloudflare_zone: zoneName,
      records: results,
    }
  }

  async resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: SyncRecord[]
  ): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = this.requireFqdn(hostname)
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, fqdn)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(hostname, effectiveOrigin)

    const afterRecords = this.collectRecords(hostname, effectiveOrigin, zoneName, cloudflareProviderId)
    const deleted = await this.deleteMissingRecords(cloudflareProviderId, zoneId, beforeRecords, afterRecords)
    const results = await Promise.all(
      afterRecords.map((record) => withSyncPurpose(record, this.syncRecord(cloudflareProviderId, zoneId, record)))
    )

    return {
      hostname_fqdn: fqdn,
      cloudflare_zone: zoneName,
      cleaned: deleted.filter((r) => r.status === 'deleted').length,
      deleted,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: SyncRecord[]): Promise<Record<string, unknown>> {
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

    const results = await Promise.all(
      records.map((record) => withSyncPurpose(record, this.deleteRecord(cloudflareProviderId, zoneId, record)))
    )
    return {
      cleaned: results.filter((r) => r.status === 'deleted').length,
      cloudflare_zone: zoneName,
      records: results,
    }
  }

  async cleanupStaleRecords(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string
  ): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }

    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') return { cleaned: 0, reason: 'fqdn_missing' }

    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, fqdn)
    const ownership = hostname.ownership_verification ?? {}
    const record = this.record(
      'TXT',
      `_cf-custom-hostname.${fqdn}`,
      String(ownership.value ?? ''),
      'ownership_verification',
      fqdn,
      zoneName,
      cloudflareProviderId
    )
    const result = await this.deleteRecord(cloudflareProviderId, zoneId, record)

    return { cleaned: result.status === 'deleted' ? 1 : 0, cloudflare_zone: zoneName, records: [result] }
  }

  async collectRecordsFor(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string
  ): Promise<{ hostname_fqdn: string; records: CloudflareDnsSyncRecord[] }> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const sync = await this.hostnames.syncConfig(providerId, String(hostname.hostname ?? ''), cfZoneName)
    let cloudflareProviderId = String(sync.sync_provider_id ?? '').trim()
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)
    const zoneName = String(sync.sync_zone ?? '').trim()

    return {
      hostname_fqdn: String(hostname.hostname ?? ''),
      records: this.collectRecords(
        hostname,
        await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname),
        zoneName,
        cloudflareProviderId,
        true
      ),
    }
  }

  private async resolveTarget(
    providerId: string,
    hostnameFqdn: string,
    explicitSyncZone = '',
    explicitSyncProviderId = '',
    skipHostnameConfig = false
  ): Promise<[string, string, string]> {
    let cloudflareProviderId = explicitSyncProviderId.trim()
    if (cloudflareProviderId === '' && !skipHostnameConfig) {
      const sync = await this.hostnames.syncConfig(providerId, hostnameFqdn)
      cloudflareProviderId = String(sync.sync_provider_id ?? '').trim()
    }
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)

    let zoneName = explicitSyncZone.toLowerCase().trim()
    if (zoneName === '' && !skipHostnameConfig) {
      const sync = await this.hostnames.syncConfig(providerId, hostnameFqdn)
      zoneName = String(sync.sync_zone ?? '')
        .toLowerCase()
        .trim()
    }
    if (zoneName === '')
      throw new ApiError('saas_cloudflare_sync_zone_missing', 'Cloudflare DNS sync zone is required', 422)

    // Guard: never try writing api.example.com into an unrelated zone like 100022.xyz.
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    if (fqdn !== zoneName && !fqdn.endsWith('.' + zoneName)) {
      throw new ApiError(
        'saas_cloudflare_sync_zone_mismatch',
        `Cloudflare DNS sync zone ${zoneName} does not match hostname ${fqdn}`,
        422,
        { hostname: fqdn, sync_zone: zoneName }
      )
    }

    const zoneId = await this.zones.idByName(cloudflareProviderId, zoneName)
    return [cloudflareProviderId, zoneId, zoneName]
  }

  private async requireCloudflareDnsProviderId(providerId: string): Promise<string> {
    const provider = await this.providers.requireType<SaaSProvider>(
      providerId,
      'saas',
      'SaaS provider not found',
      'saas_provider_not_found'
    )
    const cloudflareDns = provider.cloudflare_dns_provider ?? ''
    if (cloudflareDns !== '') return cloudflareDns
    if (provider.cloudflare_provider !== '') return provider.cloudflare_provider
    throw new ApiError(
      'saas_cloudflare_dns_provider_missing',
      'SaaS provider is not linked to a Cloudflare DNS provider',
      422
    )
  }

  private requireFqdn(hostname: CloudflareCustomHostname): string {
    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)
    return fqdn
  }

  private async resolveEffectiveOrigin(
    providerId: string,
    cfZoneName: string,
    hostname: CloudflareCustomHostname
  ): Promise<string> {
    const custom = String(hostname.custom_origin_server ?? '').trim()
    if (custom !== '') return custom
    return (await this.hostnames.fallbackOrigin(providerId, cfZoneName)) ?? ''
  }

  private requireBusinessTarget(hostname: CloudflareCustomHostname, effectiveOrigin: string): void {
    if (this.businessTarget(hostname, effectiveOrigin) === '') {
      throw new ApiError('saas_business_target_missing', 'No business CNAME target available', 422)
    }
  }

  /**
   * Cloudflare DNS has no line split (unlike DNSPod 默认/境内).
   * One business CNAME: preferred domain when set, otherwise origin/fallback.
   * Ownership TXT is not written on sync (same-zone CF often auto-verifies); includeAll still
   * surfaces existing ownership for delete cleanup only.
   */
  private businessTarget(hostname: CloudflareCustomHostname, effectiveOrigin: string): string {
    const metadata = hostname.custom_metadata ?? {}
    const preferred = String(metadata.preferred_domain ?? hostname.preferred_domain ?? '').trim()
    if (preferred !== '') return preferred
    return effectiveOrigin.trim()
  }

  private collectRecords(
    hostname: CloudflareCustomHostname,
    effectiveOrigin: string,
    zoneName: string,
    cloudflareProviderId: string,
    includeAll = false
  ): CloudflareDnsSyncRecord[] {
    const records: CloudflareDnsSyncRecord[] = []
    const fqdn = String(hostname.hostname ?? '')
    const target = this.businessTarget(hostname, effectiveOrigin)

    if (fqdn !== '' && target !== '') {
      // Single business CNAME (no DNSPod-style 境内 line). Preferred when present, else origin.
      records.push(this.record('CNAME', fqdn, target, 'origin_cname', fqdn, zoneName, cloudflareProviderId))
    }

    const ssl = hostname.ssl ?? {}
    const dcvRecords = ssl.dcv_delegation_records ?? []
    let dcvAdded = false
    for (const rec of dcvRecords) {
      const cname = String(rec.cname ?? '')
      const dcvTarget = String(rec.cname_target ?? '')
      if (cname !== '' && dcvTarget !== '') {
        records.push(this.record('CNAME', cname, dcvTarget, 'dcv_delegation', fqdn, zoneName, cloudflareProviderId))
        dcvAdded = true
      }
    }

    if (!dcvAdded && fqdn !== '') {
      const uuid = String(ssl.dcv_delegation_uuid ?? '').trim()
      if (uuid !== '') {
        records.push(
          this.record(
            'CNAME',
            `_acme-challenge.${fqdn}`,
            `${fqdn}.${uuid}.dcv.cloudflare.com`,
            'dcv_delegation',
            fqdn,
            zoneName,
            cloudflareProviderId
          )
        )
      }
    }

    // Do not create ownership TXT on sync. Only list it when collecting for cleanup/delete.
    if (includeAll) {
      const ownership = hostname.ownership_verification ?? null
      if (ownership && ownership.name && ownership.value) {
        records.push(
          this.record(
            'TXT',
            String(ownership.name),
            String(ownership.value),
            'ownership_verification',
            fqdn,
            zoneName,
            cloudflareProviderId
          )
        )
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
    zoneName: string,
    cloudflareProviderId: string
  ): CloudflareDnsSyncRecord {
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

  private async syncRecord(
    cloudflareProviderId: string,
    zoneId: string,
    record: SyncRecord
  ): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name, value: record.value }
    try {
      const matches = await this.records.findExact(cloudflareProviderId, zoneId, record.name, record.type, true)
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
        // Prefer updating the first matching type+name record when value differs.
        // Comment matching is too strict and can force create against an existing CNAME → 400.
        const updated = await this.records.update(
          cloudflareProviderId,
          zoneId,
          String(match.id),
          this.recordPayload(record)
        )
        return { ...base, status: 'updated', record_id: String(updated.id ?? match.id ?? '') }
      }

      const created = await this.records.create(cloudflareProviderId, zoneId, this.recordPayload(record))
      return { ...base, status: 'created', record_id: String(created.id ?? '') }
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        record_id: '',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async deleteRecord(
    cloudflareProviderId: string,
    zoneId: string,
    record: SyncRecord
  ): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name }
    const expectedValue = String(record.value ?? '').replace(/\.$/, '')
    const expectedComment = String(record.comment ?? '')

    for (const match of await this.records.findExact(cloudflareProviderId, zoneId, record.name, record.type, true)) {
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

  private recordPayload(record: SyncRecord): RecordPayload {
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
    beforeRecords: SyncRecord[],
    afterRecords: CloudflareDnsSyncRecord[]
  ): Promise<Record<string, unknown>[]> {
    return deleteRemovedSyncRecords(
      beforeRecords,
      afterRecords,
      (record) => syncRecordIdentity(record),
      (record) => this.deleteRecord(cloudflareProviderId, zoneId, record)
    )
  }
}
