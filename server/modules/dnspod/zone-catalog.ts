import { ApiError } from '../../core/http/api-error.js'
import { normalizeFqdn } from '../../shared/values.js'
import type { DnsPodZoneService } from './dns-pod-zone.service.js'

/** 在候选域名中做最长后缀匹配（FQDN 归属判定） */
function longestMatchingZone(fqdn: string, zoneNames: string[]): string {
  const normalized = normalizeFqdn(fqdn)
  if (normalized === '') return ''
  let best = ''
  for (const raw of zoneNames) {
    const name = raw.toLowerCase()
    if (name === '' || (normalized !== name && !normalized.endsWith(`.${name}`))) continue
    if (name.length > best.length) best = name
  }
  return best
}

/**
 * D3-2 底座：FQDN → DNSPod 域名 的唯一解析（最长后缀匹配）。
 * 与 Cloudflare 的 ZoneCatalog 对称；两条产品线不各自实现。
 */
export class DnsPodZoneCatalog {
  constructor(private readonly zones: DnsPodZoneService) {}

  /** 账号内全部域名（小写） */
  async names(providerId: string): Promise<string[]> {
    const zones = await this.zones.list(providerId)
    return zones.items.map((zone) => zone.name.toLowerCase()).filter(Boolean)
  }

  /** 最长后缀匹配；未命中返回空串 */
  async match(providerId: string, fqdn: string): Promise<string> {
    return longestMatchingZone(fqdn, await this.names(providerId))
  }

  /** 要求命中，否则按前缀抛 422 */
  async resolve(providerId: string, fqdn: string, errorCodePrefix: string): Promise<string> {
    const normalized = normalizeFqdn(fqdn)
    if (normalized === '') throw new ApiError(`${errorCodePrefix}_fqdn_empty`, 'Empty FQDN', 422)
    const best = longestMatchingZone(normalized, await this.names(providerId))
    if (best === '') {
      throw new ApiError(`${errorCodePrefix}_dnspod_zone_not_found`, `No matching DNSPod zone for ${fqdn}`, 422)
    }
    return best
  }

  /** 显式指定的域名必须存在于账号内 */
  async requireExplicit(providerId: string, zoneName: string, errorCodePrefix: string): Promise<string> {
    const normalized = normalizeFqdn(zoneName)
    if (normalized !== '' && (await this.names(providerId)).includes(normalized)) return normalized
    throw new ApiError(
      `${errorCodePrefix}_dnspod_zone_not_found`,
      normalized === '' ? 'DNSPod zone is required' : `DNSPod zone ${zoneName} not found`,
      422
    )
  }
}
