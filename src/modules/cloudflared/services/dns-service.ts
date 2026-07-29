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

    for (const record of await this.exactCnameMatches(cfProviderId, zoneId, hostname)) {
      if (String(record.name ?? '') !== hostname) continue
      if (String(record.type ?? '') === 'CNAME' && String(record.content ?? '') === cnameTarget) {
        return { action: 'unchanged', record_id: String(record.id ?? '') }
      }
      if (String(record.type ?? '') === 'CNAME') {
        const updated = await this.dns.update(cfProviderId, zoneId, String(record.id), {
          type: 'CNAME',
          name: hostname,
          content: cnameTarget,
          proxied: true,
          ttl: 1,
        })
        return { action: 'updated', record_id: String(updated.id ?? '') }
      }
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

    for (const record of await this.exactCnameMatches(cfProviderId, zoneId, hostname)) {
      if (String(record.name ?? '') === hostname && String(record.content ?? '') === cnameTarget) {
        await this.dns.delete(cfProviderId, zoneId, String(record.id))
        return { action: 'deleted', record_id: String(record.id) }
      }
    }

    return { action: 'not_found' }
  }

  private async exactCnameMatches(cfProviderId: string, zoneId: string, hostname: string): Promise<Array<Record<string, unknown>>> {
    const matches: Array<Record<string, unknown>> = []
    let page = 1
    let totalPages: number

    do {
      const result = await this.dns.list(cfProviderId, zoneId, { type: 'CNAME', search: hostname, page, per_page: 100 })
      for (const record of result.items) {
        if (String(record.name ?? '') === hostname) {
          matches.push(record)
        }
      }
      totalPages = Number(result.pagination.total_pages ?? result.pagination.total_count ?? 1)
      page++
    } while (page <= totalPages)

    return matches
  }

  private async resolveZoneId(cfProviderId: string, fqdn: string): Promise<string> {
    const normalized = fqdn.replace(/\.$/, '').trim().toLowerCase()
    if (normalized === '') return ''

    const zones = await this.allZones(cfProviderId)
    let bestName = ''
    let bestId = ''

    for (const zone of zones) {
      const name = String(zone.name ?? '').toLowerCase()
      const id = String(zone.id ?? '')
      if (name === '' || id === '') continue
      if ((normalized === name || normalized.endsWith('.' + name)) && name.length > bestName.length) {
        bestName = name
        bestId = id
      }
    }

    return bestId
  }

  private async allZones(cfProviderId: string): Promise<Array<Record<string, unknown>>> {
    return (await this.cfZones.listAll(cfProviderId, true)).items
  }
}
