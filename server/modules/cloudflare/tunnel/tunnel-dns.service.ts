import type { DnsRecordPort } from '../../../core/contracts/dns-record.port.js'
import { relativeRecordName } from '../../../core/contracts/dns-record.port.js'
import { errorMessage, normalizeFqdn } from '../../../shared/values.js'
import type { DnsOperationResult } from '../../../core/providers/side-effect-result.js'
import type { ZoneRef } from '../zone-catalog.js'

const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`

/**
 * 隧道路由对应的 Cloudflare CNAME（主机名 → <tunnel>.cfargotunnel.com）。
 * 记录必须代理；同名记录不属于本隧道时跳过，绝不覆盖其它隧道或人工记录。
 * 只依赖 DnsRecordPort（属于域层底座，不依赖上层写流水线）。所有方法不抛异常。
 */
export class TunnelDnsService {
  constructor(private readonly port: DnsRecordPort) {}

  /** 创建 CNAME 指向隧道；同名记录不属于本隧道时跳过，不覆盖 */
  ensureCname(zone: ZoneRef, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    return safely(async () => {
      const fqdn = normalizeFqdn(hostname)
      const content = tunnelTarget(tunnelId)
      const name = relativeRecordName(fqdn, zone.zoneName)
      const records = await this.port.find(zone.providerId, zone.zoneName, { name, type: 'CNAME' })
      const owned = records.find((ref) => ref.value.value === content)
      if (owned) return { action: 'unchanged', record_id: owned.id }

      // 与 removeCname 相同的归属保护：只管理指向本隧道的记录，绝不覆盖其它隧道或人工记录
      const [conflict] = records
      if (conflict) {
        return {
          action: 'skipped',
          reason: 'record_conflict',
          record_id: conflict.id,
          existing_content: conflict.value.value,
          message: `已跳过 ${fqdn}：同名 CNAME 指向 ${conflict.value.value || '未知目标'}`,
        }
      }

      const created = await this.port.create(zone.providerId, zone.zoneName, {
        type: 'CNAME',
        name,
        value: content,
        proxied: true,
        ttl: 1,
      })
      return { action: 'created', record_id: created.id }
    })
  }

  /** 删除指向该隧道的 CNAME；不会误删指向其他目标的同名记录 */
  removeCname(zone: ZoneRef, hostname: string, tunnelId: string): Promise<DnsOperationResult> {
    return safely(async () => {
      const fqdn = normalizeFqdn(hostname)
      const records = await this.port.find(zone.providerId, zone.zoneName, {
        name: relativeRecordName(fqdn, zone.zoneName),
        type: 'CNAME',
      })
      const match = records.find((ref) => ref.value.value === tunnelTarget(tunnelId))
      if (!match) return { action: 'not_found' }
      await this.port.remove(zone.providerId, zone.zoneName, match.id)
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
