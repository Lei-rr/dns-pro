import type { DnsPodRecordService } from '../../dnspod/services/record-service.js'
import type { CloudflareDnsRecordService } from '../../cloudflare/services/dns-record-service.js'
import type { CloudflareZoneService } from '../../cloudflare/services/zone-service.js'

/**
 * Thin application usecase for DNS record mutations.
 * Controllers call this instead of provider services directly.
 */
export class DnsRecordMutationUseCase {
  constructor(
    private readonly dnspodRecords: DnsPodRecordService,
    private readonly cloudflareRecords: CloudflareDnsRecordService,
    private readonly cloudflareZones: CloudflareZoneService,
  ) {}

  async create(providerType: string, providerId: string, zone: string, data: Record<string, unknown>) {
    if (providerType === 'cloudflare') {
      const zoneId = await this.cloudflareZones.idByName(providerId, zone)
      return this.cloudflareRecords.create(providerId, zoneId, data as any)
    }
    return this.dnspodRecords.create(providerId, zone, data as any)
  }

  async update(
    providerType: string,
    providerId: string,
    zone: string,
    recordId: string,
    data: Record<string, unknown>,
  ) {
    if (providerType === 'cloudflare') {
      const zoneId = await this.cloudflareZones.idByName(providerId, zone)
      return this.cloudflareRecords.update(providerId, zoneId, recordId, data as any)
    }
    return this.dnspodRecords.update(providerId, zone, recordId, data as any)
  }

  async delete(providerType: string, providerId: string, zone: string, recordId: string) {
    if (providerType === 'cloudflare') {
      const zoneId = await this.cloudflareZones.idByName(providerId, zone)
      return this.cloudflareRecords.delete(providerId, zoneId, recordId)
    }
    return this.dnspodRecords.delete(providerId, zone, recordId)
  }
}
