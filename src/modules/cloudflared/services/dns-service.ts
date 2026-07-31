import { CloudflareZoneService } from '../../cloudflare/services/zone-service.js'
import { CloudflareDnsRecordService } from '../../cloudflare/services/dns-record-service.js'
import type { DnsOperationResult } from '../../../lib/utils/side-effect-result.js'

export class CloudflaredDnsService {
  constructor(
    private readonly cfZones: CloudflareZoneService,
    private readonly dns: CloudflareDnsRecordService
  ) {}

  async safeEnsureCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    try {
      return await this.ensureCname(cfProviderId, zoneId, hostname, tunnelId)
    } catch (error) {
      return { action: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }

  async safeRemoveCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    try {
      const resolvedZoneId = zoneId !== '' ? zoneId : await this.resolveZoneId(cfProviderId, hostname)
      if (resolvedZoneId === '') return { action: 'skipped', reason: 'zone_not_found' }
      return await this.removeCname(cfProviderId, resolvedZoneId, hostname, tunnelId)
    } catch (error) {
      return { action: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }

  async removeCnameBestEffort(cfProviderId: string, hostname: string, tunnelId: string): Promise<void> {
    const normalized = hostname.toLowerCase().trim()
    const zoneId = await this.resolveZoneId(cfProviderId, normalized)
    if (zoneId === '') return
    try {
      await this.removeCname(cfProviderId, zoneId, normalized, tunnelId)
    } catch {
      // ignore
    }
  }

  private async ensureCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    const cnameTarget = `${tunnelId}.cfargotunnel.com`

    for (const record of await this.dns.findExact(cfProviderId, zoneId, hostname, 'CNAME', true)) {
      if (String(record.content ?? '') === cnameTarget) {
        return { action: 'unchanged', record_id: String(record.id ?? '') }
      }
      const updated = await this.dns.update(cfProviderId, zoneId, String(record.id), {
        type: 'CNAME',
        name: hostname,
        content: cnameTarget,
        proxied: true,
        ttl: 1,
      })
      return { action: 'updated', record_id: String(updated.id ?? '') }
    }

    const created = await this.dns.create(cfProviderId, zoneId, {
      type: 'CNAME',
      name: hostname,
      content: cnameTarget,
      proxied: true,
      ttl: 1,
    })
    return { action: 'created', record_id: String(created.id ?? '') }
  }

  private async removeCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    const cnameTarget = `${tunnelId}.cfargotunnel.com`

    for (const record of await this.dns.findExact(cfProviderId, zoneId, hostname, 'CNAME', true)) {
      if (String(record.content ?? '') === cnameTarget) {
        await this.dns.delete(cfProviderId, zoneId, String(record.id))
        return { action: 'deleted', record_id: String(record.id) }
      }
    }

    return { action: 'not_found' }
  }

  private async resolveZoneId(cfProviderId: string, fqdn: string): Promise<string> {
    return this.cfZones.bestMatchId(cfProviderId, fqdn, true)
  }
}
