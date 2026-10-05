import { normalizeFqdn, toAsciiFqdn } from '../../shared/values.js'
import { providerCacheTag, withProviderCache, zoneCacheTag } from '../../core/cache/provider-cache.js'
import { callProvider } from '../../core/providers/provider-call.js'
import type { CloudflareZonePort } from '../../core/contracts/cloudflare-zone.port.js'
import { parseCloudflareItemResponse } from './cloudflare-response.schema.js'
import { CLOUDFLARE_PROVIDER_TYPE } from './cloudflare.cache.js'
import type { CloudflareAccess } from './access.js'
import type { CloudflareZoneService } from './cloudflare-zone.service.js'

export interface ZoneRef {
  providerId: string
  zoneId: string
  zoneName: string
}

/** D2 底座：FQDN → 所属站点 的唯一定义（最长后缀匹配 + DCV 委派）；站点标识解析经端口 CloudflareZonePort 供编排消费 */
export class ZoneCatalog implements CloudflareZonePort {
  constructor(
    private readonly access: CloudflareAccess,
    private readonly zones: CloudflareZoneService
  ) {}

  /** 端口 CloudflareZonePort：站点名 → 站点 ID（账号内无此站点抛 404 cloudflare_zone_not_found） */
  idByName(providerId: string, zoneName: string): Promise<string> {
    return this.zones.idByName(providerId, zoneName)
  }

  /** 最长后缀匹配 FQDN 所属站点；未匹配返回 null */
  async resolve(providerId: string, fqdn: string, refresh = false): Promise<ZoneRef | null> {
    // 站点名来自上游，已是 punycode：入参含非 ASCII 时必须先转 ASCII，否则恒不匹配
    const normalized = toAsciiFqdn(fqdn)
    let best: ZoneRef | null = null
    let bestLength = -1
    for (const zone of (await this.zones.listAll(providerId, refresh)).items) {
      const name = normalizeFqdn(zone.name)
      if (!name || !zone.id) continue
      if ((normalized === name || normalized.endsWith(`.${name}`)) && name.length > bestLength) {
        best = { providerId, zoneId: zone.id, zoneName: name }
        bestLength = name.length
      }
    }
    return best
  }

  /** 站点级 DCV 委派 UUID（SaaS 证书委派用） */
  async dcvDelegationUuid(providerId: string, zoneId: string, refresh = false): Promise<string> {
    const cached = await withProviderCache<{ uuid: string }>({
      key: {
        prefix: `${CLOUDFLARE_PROVIDER_TYPE}:dcv_delegation`,
        parts: { provider_id: providerId, zone_id: zoneId },
      },
      tags: [providerCacheTag(providerId), zoneCacheTag(CLOUDFLARE_PROVIDER_TYPE, providerId)],
      refresh,
      loader: async () => {
        const { client } = await this.access.forProvider(providerId)
        const response = await callProvider(
          {
            code: 'cloudflare_dcv_failed',
            message: 'Cloudflare DCV delegation fetch failed',
            providerId,
            details: { zone: zoneId },
          },
          () => client.get(`zones/${encodeURIComponent(zoneId)}/dcv_delegation/uuid`)
        )
        return { uuid: String(parseCloudflareItemResponse(response).result.uuid ?? '') }
      },
    })
    return cached.value.uuid
  }
}
