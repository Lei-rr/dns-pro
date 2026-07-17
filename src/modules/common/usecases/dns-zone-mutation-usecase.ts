import type { DnsPodZoneService } from '../../dnspod/services/zone-service.js'
import type { CloudflareZoneService } from '../../cloudflare/services/zone-service.js'

/**
 * Thin application usecase for DNS zone mutations.
 */
export class DnsZoneMutationUseCase {
  constructor(
    private readonly dnspodZones: DnsPodZoneService,
    private readonly cloudflareZones: CloudflareZoneService,
  ) {}

  async create(providerType: string, providerId: string, data: Record<string, unknown>) {
    if (providerType === 'cloudflare') {
      return this.cloudflareZones.create(
        providerId,
        String(data.name ?? data.domain ?? ''),
        String(data.type ?? 'full'),
      )
    }
    return this.dnspodZones.create(providerId, String(data.domain ?? data.name ?? ''))
  }

  async delete(providerType: string, providerId: string, zone: string) {
    if (providerType === 'cloudflare') {
      const zoneId = await this.cloudflareZones.idByName(providerId, zone)
      return this.cloudflareZones.delete(providerId, zoneId)
    }
    return this.dnspodZones.delete(providerId, zone)
  }
}
