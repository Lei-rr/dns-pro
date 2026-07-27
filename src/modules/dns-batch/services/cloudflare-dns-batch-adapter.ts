import { CloudflareDnsRecordService } from '../../cloudflare/services/dns-record-service.js'
import { CloudflareZoneService } from '../../cloudflare/services/zone-service.js'

/**
 * Batch jobs receive route zone **names** (e.g. guolei.cc).
 * CloudflareDnsRecordService expects zone **IDs** — resolve once per job scope and reuse.
 */
export class CloudflareDnsBatchAdapter {
  private readonly zoneIdCache = new Map<string, Promise<string>>()

  constructor(
    private readonly zones: CloudflareZoneService,
    private readonly records: CloudflareDnsRecordService,
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

  async create(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown> {
    return this.records.create(providerId, await this.zoneId(providerId, zone), data)
  }

  async delete(providerId: string, zone: string, recordId: string): Promise<unknown> {
    return this.records.delete(providerId, await this.zoneId(providerId, zone), recordId)
  }

  async update(
    providerId: string,
    zone: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.records.update(providerId, await this.zoneId(providerId, zone), recordId, data)
  }
}
