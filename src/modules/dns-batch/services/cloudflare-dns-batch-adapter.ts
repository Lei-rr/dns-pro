import { CloudflareDnsRecordService } from '../../cloudflare/services/dns-record-service.js'
import { CloudflareZoneService } from '../../cloudflare/services/zone-service.js'

/**
 * Batch jobs receive route zone **names** (e.g. guolei.cc).
 * CloudflareDnsRecordService expects zone **IDs** — resolve before every call.
 * Controllers already do idByName for single-record APIs; batch previously skipped that.
 */
export class CloudflareDnsBatchAdapter {
  constructor(
    private readonly zones: CloudflareZoneService,
    private readonly records: CloudflareDnsRecordService,
  ) {}

  private async zoneId(providerId: string, zone: string): Promise<string> {
    return this.zones.idByName(providerId, zone)
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
