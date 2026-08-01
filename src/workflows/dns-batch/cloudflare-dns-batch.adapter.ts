import { CloudflareDnsRecordService } from '../../modules/cloudflare/cloudflare-dns-record.service.js'
import { CloudflareZoneService } from '../../modules/cloudflare/cloudflare-zone.service.js'
import { cloudflareCreateMatches } from './dns-record-equivalence.js'

/**
 * Batch jobs receive route zone **names** (e.g. example.com).
 * CloudflareDnsRecordService expects zone **IDs** — resolve once per job scope and reuse.
 */
export class CloudflareDnsBatchAdapter {
  private readonly zoneIdCache = new Map<string, Promise<string>>()

  constructor(
    private readonly zones: CloudflareZoneService,
    private readonly records: CloudflareDnsRecordService
  ) {}

  private zoneId(providerId: string, zone: string): Promise<string> {
    const key = `${providerId}\0${zone}`
    let pending = this.zoneIdCache.get(key)
    if (!pending) {
      pending = this.zones.idByName(providerId, zone)
      this.zoneIdCache.set(key, pending)
      pending.catch(() => this.zoneIdCache.delete(key))
    }
    return pending
  }

  async findCreate(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown | null> {
    const zoneId = await this.zoneId(providerId, zone)
    const matches = await this.records.findExact(
      providerId,
      zoneId,
      String(data.name || ''),
      String(data.type || ''),
      true
    )
    return matches.find((record) => cloudflareCreateMatches(record, data)) ?? null
  }

  async create(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown> {
    return this.records.create(providerId, await this.zoneId(providerId, zone), data)
  }

  async delete(providerId: string, zone: string, recordId: string): Promise<unknown> {
    return this.records.delete(providerId, await this.zoneId(providerId, zone), recordId)
  }

  async update(providerId: string, zone: string, recordId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.records.update(providerId, await this.zoneId(providerId, zone), recordId, data)
  }
}
