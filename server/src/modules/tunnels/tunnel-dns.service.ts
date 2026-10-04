import type { CloudflareDnsRecordService } from '../cloudflare/cloudflare-dns-record.service.js'
import type { CloudflareZoneService } from '../cloudflare/cloudflare-zone.service.js'
import { errorMessage, normalizeFqdn } from '../../shared/lib/values.js'
import type { DnsOperationResult } from '../../shared/providers/side-effect-result.js'

const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`

/** 隧道路由对应的 Cloudflare CNAME（主机名 → <tunnel>.cfargotunnel.com）；所有方法不抛异常 */
export class TunnelDnsService {
  constructor(
    private readonly zones: CloudflareZoneService,
    private readonly records: CloudflareDnsRecordService
  ) {}

  /** 创建或更新 CNAME 指向隧道 */
  ensureCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    return safely(async () => {
      const content = tunnelTarget(tunnelId)
      const [existing] = await this.records.findExact(cfProviderId, zoneId, hostname, 'CNAME')
      if (existing && existing.content === content) return { action: 'unchanged', record_id: existing.id ?? '' }

      const payload = { type: 'CNAME', name: hostname, content, proxied: true, ttl: 1 }
      if (existing?.id) {
        const updated = await this.records.update(cfProviderId, zoneId, existing.id, payload)
        return { action: 'updated', record_id: updated.id ?? '' }
      }
      const created = await this.records.create(cfProviderId, zoneId, payload)
      return { action: 'created', record_id: created.id ?? '' }
    })
  }

  /** 删除指向该隧道的 CNAME；不会误删指向其他目标的同名记录 */
  removeCname(cfProviderId: string, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    return safely(async () => {
      const fqdn = normalizeFqdn(hostname)
      const zoneId = await this.zones.bestMatchId(cfProviderId, fqdn, true)
      if (zoneId === '') return { action: 'skipped', reason: 'zone_not_found' }

      const records = await this.records.findExact(cfProviderId, zoneId, fqdn, 'CNAME')
      const match = records.find((record) => record.content === tunnelTarget(tunnelId) && record.id)
      if (!match?.id) return { action: 'not_found' }
      await this.records.delete(cfProviderId, zoneId, match.id)
      return { action: 'deleted', record_id: match.id }
    })
  }
}

async function safely(fn: () => Promise<DnsOperationResult>): Promise<DnsOperationResult> {
  try {
    return await fn()
  } catch (error) {
    return { action: 'failed', error: errorMessage(error) }
  }
}
