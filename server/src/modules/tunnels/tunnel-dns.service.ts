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

  /** 创建 CNAME 指向隧道；同名记录不属于本隧道时跳过，不覆盖 */
  ensureCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    return safely(async () => {
      const content = tunnelTarget(tunnelId)
      const records = await this.records.findExact(cfProviderId, zoneId, hostname, 'CNAME')
      const owned = records.find((record) => record.content === content && record.id)
      if (owned?.id) return { action: 'unchanged', record_id: owned.id }

      // 与 removeCname 相同的归属保护：只管理指向本隧道的记录，绝不覆盖其它隧道或人工记录
      const [conflict] = records
      if (conflict) {
        return {
          action: 'skipped',
          reason: 'record_conflict',
          record_id: conflict.id ?? '',
          existing_content: conflict.content,
          message: `已跳过 ${hostname}：同名 CNAME 指向 ${conflict.content ?? '未知目标'}`,
        }
      }

      const created = await this.records.create(cfProviderId, zoneId, {
        type: 'CNAME',
        name: hostname,
        content,
        proxied: true,
        ttl: 1,
      })
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
