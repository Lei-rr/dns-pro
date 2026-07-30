import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { wrapProviderError } from '../../../lib/http/wrap-provider-error.js'
import { CacheTtl, edgeoneZonesCacheTag, withProviderCache } from '../../../lib/cache/provider-cache.js'
import { EdgeOneGateway } from '../gateways/gateway.js'
import { edgeOneZoneSchema, edgeoneZoneListResponseSchema } from '../../../lib/providers/edgeone-response.js'
import type { DnsPodProvider } from '../../provider/types.js'
import { resolveEdgeOneApiCredentials } from '../credentials.js'

export interface EdgeOneZone {
  id: string
  name: string
  area?: string
  type?: string
  status?: string
  active_status?: string
  lock_status?: string
  paused?: boolean
  created_on?: string
  modified_on?: string
}

export class EdgeOneZoneService {
  constructor(private readonly providers: ProviderRepository) {}

  // 站点通常不多，直接全量拉取返回。
  async zones(providerId: string, refresh = false): Promise<{ items: EdgeOneZone[]; pagination: Record<string, unknown>; meta: Record<string, unknown> }> {
    const cached = await withProviderCache<{ items: EdgeOneZone[]; pagination: Record<string, unknown>; meta: Record<string, unknown>; request_id?: string }>({
      key: `edgeone:zones:${providerId}:all`,
      tags: [edgeoneZonesCacheTag(providerId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const provider = await resolveEdgeOneApiCredentials(this.providers, providerId)
        const gateway = this.gatewayFor(provider)

        let pageOffset = 0
        const pageLimit = 100
        const items: EdgeOneZone[] = []
        let requestId: string | undefined
        let hasMore = true

        while (hasMore) {
          let response
          try {
            response = await gateway.call('DescribeZones', {
              Offset: Number(pageOffset),
              Limit: Number(pageLimit),
            })
          } catch (error) {
            throw wrapProviderError('edgeone_zone_list_failed', 'EdgeOne zone list failed', providerId, error)
          }
          const parsed = edgeoneZoneListResponseSchema.parse(response)

          requestId = parsed.RequestId ?? undefined
          const vendorPageItems = Array.isArray(parsed.Zones) ? parsed.Zones : []
          const pageItems = vendorPageItems
            .map((zone) => this.presentZone(edgeOneZoneSchema.parse(zone)))
            .filter((zone) => !['pages', 'ai'].includes(String(zone.type ?? '').toLowerCase()))
          items.push(...pageItems)

          pageOffset += vendorPageItems.length
          const total = Number(parsed.TotalCount ?? pageOffset)
          hasMore = vendorPageItems.length >= pageLimit && pageOffset < total
        }

        const total = items.length
        return {
          items,
          pagination: { offset: 0, limit: total, total },
          meta: {
            page: 1,
            per_page: total,
            offset: 0,
            limit: total,
            total,
            total_pages: 1,
          },
          request_id: requestId,
        }
      },
    })
    return cached.value
  }

  async zoneById(providerId: string, zoneId: string, refresh = false): Promise<EdgeOneZone> {
    const zones = await this.zones(providerId, refresh)
    const zone = zones.items.find((item) => item.id === zoneId)
    if (!zone) {
      throw new ApiError('edgeone_zone_not_found', `EdgeOne zone ${zoneId} not found`, 404)
    }
    return zone
  }

  private presentZone(zone: import('../../../lib/providers/edgeone-response.js').EdgeOneZone): EdgeOneZone {
    return {
      id: zone.ZoneId ?? '',
      name: zone.ZoneName ?? '',
      area: zone.Area ?? undefined,
      type: zone.Type ?? undefined,
      status: zone.Status ?? undefined,
      active_status: zone.ActiveStatus ?? undefined,
      lock_status: zone.LockStatus ?? undefined,
      paused: zone.Paused ?? undefined,
      created_on: zone.CreatedOn ?? undefined,
      modified_on: zone.ModifiedOn ?? undefined,
    }
  }

  private gatewayFor(provider: DnsPodProvider): EdgeOneGateway {
    return EdgeOneGateway.forCredentials({
      secretId: provider.secret_id,
      secretKey: provider.secret_key,
    })
  }

}
