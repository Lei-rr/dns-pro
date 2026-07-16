import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { CacheTtl, globalCache } from '../../../lib/cache/provider-cache.js'
import { EdgeOneGateway } from '../gateways/gateway.js'
import { edgeOneZoneSchema, edgeoneZoneListResponseSchema } from '../../../lib/providers/edgeone-response.js'
import type { DnsPodProvider, EdgeOneProvider } from '../../provider/types.js'

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
  private credentialCache = new Map<string, DnsPodProvider>()

  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  // 站点通常不多，直接全量拉取返回。
  async zones(providerId: string, refresh = false): Promise<{ items: EdgeOneZone[]; pagination: Record<string, unknown>; meta: Record<string, unknown> }> {
    const cacheKey = `edgeone:zones:${providerId}:all`
    if (!refresh) {
      const cached = globalCache.get<{ items: EdgeOneZone[]; pagination: Record<string, unknown>; meta: Record<string, unknown> }>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.credentialProvider(providerId)
    const gateway = new EdgeOneGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let pageOffset = 0
    const pageLimit = 100
    const items: EdgeOneZone[] = []
    let requestId: string | undefined
    let hasMore = true

    while (hasMore) {
      const response = await gateway.call('DescribeZones', {
        Offset: Number(pageOffset),
        Limit: Number(pageLimit),
      })
      const parsed = edgeoneZoneListResponseSchema.parse(response)

      requestId = parsed.RequestId ?? undefined
      const pageItems = (parsed.Zones ?? [])
        .map((zone: any) => this.presentZone(edgeOneZoneSchema.parse(zone)))
        .filter((zone: any) => !['pages', 'ai'].includes(zone.type?.toLowerCase() ?? ''))
      items.push(...pageItems)

      pageOffset += pageItems.length
      const total = Number(parsed.TotalCount ?? items.length)
      hasMore = pageItems.length >= pageLimit && pageOffset < total
    }

    const total = items.length
    const result = {
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

    globalCache.set(cacheKey, result, CacheTtl.providerData, [`edgeone:zones:${providerId}`])
    return result
  }

  async zoneById(providerId: string, zoneId: string): Promise<EdgeOneZone> {
    const zones = await this.zones(providerId)
    const zone = zones.items.find((item) => item.id === zoneId)
    if (!zone) {
      throw new ApiError('edgeone_zone_not_found', `EdgeOne zone ${zoneId} not found`, 404)
    }
    return zone
  }

  private async credentialProvider(providerId: string): Promise<DnsPodProvider> {
    const cached = this.credentialCache.get(providerId)
    if (cached) return cached

    const edgeoneProvider = await this.providers.requireType<EdgeOneProvider>(providerId, 'edgeone', 'EdgeOne provider not found', 'edgeone_provider_not_found')
    const dnspodProviderId = edgeoneProvider.dnspod_provider.trim()
    if (dnspodProviderId === '') {
      throw new ApiError('edgeone_dnspod_provider_not_found', 'EdgeOne provider is not linked to a DNSPod provider', 422)
    }

    const dnspodProvider = await this.providers.requireType<DnsPodProvider>(dnspodProviderId, 'dnspod', 'DNSPod provider not found', 'dnspod_provider_not_found')
    this.credentialCache.set(providerId, dnspodProvider)
    return dnspodProvider
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
}
