import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { DnsPodZoneService } from '../../dnspod/services/zone-service.js'
import { DnsPodRecordService, type RecordCreateInput } from '../../dnspod/services/record-service.js'
import type { EdgeOneProvider, ProviderType, SaasProvider } from '../../provider/types.js'
import type { SyncRecord } from '../types.js'

export interface PrecleanedRecord {
  type: string
  name: string
  value: string
  record_id: string
  status: string
  error?: string
}

export interface DeletedRecord {
  type: string
  name: string
  record_id: string
  status: string
  error?: string
}

export interface DnsPodSyncRecord extends SyncRecord {
  line?: string
  remark?: string
  ttl?: number
  dnspod_zone?: string
}

export class DnsPodRecordOps {
  constructor(
    private readonly providers: ProviderRepository = new ProviderRepository(),
    private readonly zones: DnsPodZoneService = new DnsPodZoneService(),
    private readonly records: DnsPodRecordService = new DnsPodRecordService()
  ) {}

  async lookupDnspodProviderId(providerId: string, providerType: string, label: string): Promise<string> {
    const provider = await this.providers.requireType(providerId, providerType as ProviderType, `${label} provider not found`, `${providerType}_provider_not_found`)
    if (provider.type === 'edgeone') return (provider as EdgeOneProvider).dnspod_provider
    if (provider.type === 'saas') return (provider as SaasProvider).dnspod_provider ?? ''
    return ''
  }

  async requireDnspodProviderId(providerId: string, providerType: string, label: string): Promise<string> {
    const id = await this.lookupDnspodProviderId(providerId, providerType, label)
    if (id === '') {
      throw new ApiError(`${providerType}_dnspod_provider_missing`, `${label} provider is not linked to a DNSPod provider`, 422)
    }
    return id
  }

  async resolveDnspodZone(dnspodProviderId: string, fqdn: string, errorCodePrefix: string): Promise<string> {
    const normalizedFqdn = fqdn.toLowerCase().replace(/\.$/, '')
    if (normalizedFqdn === '') {
      throw new ApiError(`${errorCodePrefix}_fqdn_empty`, 'Empty FQDN', 422)
    }

    const zones = await this.zones.list(dnspodProviderId, { offset: 0, limit: 3000 })
    let best = ''
    for (const zone of zones.items) {
      const name = String(zone.name ?? '').toLowerCase()
      if (name === '') continue
      if ((normalizedFqdn === name || normalizedFqdn.endsWith('.' + name)) && name.length > best.length) {
        best = name
      }
    }

    if (best === '') {
      throw new ApiError(`${errorCodePrefix}_dnspod_zone_not_found`, `No matching DNSPod zone for ${fqdn}`, 422)
    }
    return best
  }

  async requireExplicitDnspodZone(dnspodProviderId: string, zoneName: string, errorCodePrefix: string): Promise<string> {
    const normalized = zoneName.toLowerCase().trim()
    if (normalized === '') {
      throw new ApiError(`${errorCodePrefix}_dnspod_zone_not_found`, 'DNSPod zone is required', 422)
    }

    const zones = await this.zones.list(dnspodProviderId, { offset: 0, limit: 3000 })
    for (const zone of zones.items) {
      const name = String(zone.name ?? '').toLowerCase()
      if (name === normalized) return name
    }

    throw new ApiError(`${errorCodePrefix}_dnspod_zone_not_found`, `DNSPod zone ${zoneName} not found`, 422)
  }

  async precleanConflicts(dnspodProviderId: string, dnspodZone: string, fqdn: string): Promise<PrecleanedRecord[]> {
    const subdomain = this.subdomainFromFqdn(fqdn, dnspodZone)
    let listing
    try {
      listing = await this.records.list(dnspodProviderId, dnspodZone, {
        offset: 0,
        limit: 100,
        subdomain,
        record_type: '',
        keyword: '',
        refresh: true,
      })
    } catch {
      return []
    }

    const keepTypes = new Set(['CNAME', 'TXT'])
    const deleted: PrecleanedRecord[] = []

    for (const item of listing.items ?? []) {
      const type = String(item.type ?? '')
      const name = String(item.name ?? '')
      if (name !== subdomain || type === '' || keepTypes.has(type)) continue
      const recordId = String(item.id ?? '')
      const entry: PrecleanedRecord = {
        type,
        name: fqdn,
        value: String(item.value ?? ''),
        record_id: recordId,
        status: 'not_found',
      }
      if (recordId === '') {
        deleted.push(entry)
        continue
      }
      try {
        await this.records.delete(dnspodProviderId, dnspodZone, recordId)
        deleted.push({ ...entry, status: 'deleted' })
      } catch (error) {
        deleted.push({ ...entry, status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }

    return deleted
  }

  async deleteRecordsByNameType(dnspodProviderId: string, dnspodZone: string, fqdn: string, type: string, line = '默认'): Promise<DeletedRecord[]> {
    const subdomain = this.subdomainFromFqdn(fqdn, dnspodZone)
    let listing
    try {
      listing = await this.records.list(dnspodProviderId, dnspodZone, {
        offset: 0,
        limit: 100,
        subdomain,
        record_type: type,
        keyword: '',
        refresh: true,
      })
    } catch {
      return []
    }

    const results: DeletedRecord[] = []
    for (const item of listing.items ?? []) {
      if (String(item.type ?? '') !== type || String(item.name ?? '') !== subdomain || (item.line ?? '默认') !== line) {
        continue
      }
      const recordId = String(item.id ?? '')
      const entry: DeletedRecord = { type, name: fqdn, record_id: recordId, status: 'not_found' }
      if (recordId === '') {
        results.push(entry)
        continue
      }
      try {
        await this.records.delete(dnspodProviderId, dnspodZone, recordId)
        results.push({ ...entry, status: 'deleted' })
      } catch (error) {
        results.push({ ...entry, status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }

    return results
  }

  async sync(providerId: string, zone: string, record: SyncRecord): Promise<Record<string, unknown>> {
    const base = this.baseResult(record)
    try {
      const subdomain = this.subdomainFromFqdn(record.name, zone)
      const line = String(record.line ?? '默认')
      const matches = await this.findMatching(providerId, zone, subdomain, record.type, line)
      const payload = this.buildPayload(record, subdomain, line)

      if (matches.length === 0) {
        const created = await this.records.create(providerId, zone, payload)
        return { ...base, status: 'created', record_id: String(created.id) }
      }

      const expectedRemark = String(record.remark ?? '')
      for (const match of matches) {
        if (String(match.value ?? '') !== record.value) continue
        const currentRemark = String(match.remark ?? '')
        const currentTtl = match.ttl ?? 600
        const expectedTtl = payload.ttl ?? 600
        if (currentRemark === expectedRemark && currentTtl === expectedTtl) {
          return { ...base, status: 'unchanged', record_id: String(match.id) }
        }
        const recordId = String(match.id)
        if (recordId !== '') {
          await this.records.update(providerId, zone, recordId, payload)
          return { ...base, status: 'updated', record_id: recordId }
        }
      }

      const first = matches[0]
      const firstId = String(first?.id ?? '')
      if (firstId !== '') {
        await this.records.update(providerId, zone, firstId, payload)
        return { ...base, status: 'updated', record_id: firstId }
      }

      const created = await this.records.create(providerId, zone, payload)
      return { ...base, status: 'created', record_id: String(created.id) }
    } catch (error) {
      return { ...base, status: 'failed', record_id: '', error: error instanceof Error ? error.message : String(error) }
    }
  }

  async check(providerId: string, zone: string, record: SyncRecord): Promise<Record<string, unknown>> {
    const subdomain = this.subdomainFromFqdn(record.name, zone)
    const matches = await this.findMatching(providerId, zone, subdomain, record.type, String(record.line ?? '默认'))
    const expected = record.value.replace(/\.$/, '')
    const synced = matches.some((match) => String(match.value ?? '').replace(/\.$/, '') === expected)
    return { ...this.baseResult(record), synced }
  }

  async delete(providerId: string, zone: string, record: SyncRecord): Promise<Record<string, unknown>> {
    const subdomain = this.subdomainFromFqdn(record.name, zone)
    const matches = await this.findMatching(providerId, zone, subdomain, record.type, String(record.line ?? '默认'))
    const expected = String(record.value ?? '').replace(/\.$/, '')

    const base = { type: record.type, name: record.name }
    const match = matches.find((candidate) => {
      if (expected === '') return true
      return String(candidate.value ?? '').replace(/\.$/, '') === expected
    })

    if (!match) {
      return { ...base, status: 'not_found', record_id: '' }
    }

    const recordId = String(match.id)
    try {
      await this.records.delete(providerId, zone, recordId)
      return { ...base, status: 'deleted', record_id: recordId }
    } catch (error) {
      return { ...base, status: 'failed', record_id: recordId, error: error instanceof Error ? error.message : String(error) }
    }
  }

  subdomainFromFqdn(fqdn: string, zoneName: string): string {
    const normalizedFqdn = fqdn.toLowerCase().replace(/\.$/, '')
    const zone = zoneName.toLowerCase()
    if (normalizedFqdn === zone) return '@'
    const suffix = '.' + zone
    if (normalizedFqdn.endsWith(suffix)) {
      return normalizedFqdn.slice(0, -suffix.length)
    }
    return normalizedFqdn
  }

  private async findMatching(providerId: string, zone: string, subdomain: string, type: string, line: string) {
    const listing = await this.records.list(providerId, zone, {
      offset: 0,
      limit: 100,
      subdomain,
      record_type: type,
      keyword: '',
      // Always refresh during sync so preferred CNAME value updates are not matched against stale cache.
      refresh: true,
    })

    return (listing.items ?? []).filter((record) => {
      return record.type === type && record.name === subdomain && (record.line ?? '默认') === line
    })
  }

  private buildPayload(record: SyncRecord, subdomain: string, line: string): RecordCreateInput {
    return {
      record_type: record.type,
      record_line: line,
      value: record.value,
      subdomain,
      ttl: Number(record.ttl ?? 600),
      remark: String(record.remark ?? ''),
    }
  }

  private baseResult(record: SyncRecord): Record<string, unknown> {
    return {
      type: record.type,
      name: record.name,
      value: record.value,
    }
  }
}
