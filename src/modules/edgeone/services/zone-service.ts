import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { globalCache } from '../../../lib/cache/cache-service.js'
import { EdgeOneGateway } from '../gateways/gateway.js'
import { edgeOneZoneSchema, edgeoneZoneListResponseSchema } from '../schemas/response.js'
import type { DnsPodProvider, EdgeOneProvider } from '../../provider/types.js'

const TTL_MS = 3 * 24 * 60 * 60 * 1000

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

  async zones(providerId: string, offset = 0, limit = 20, refresh = false): Promise<{ items: EdgeOneZone[]; pagination: Record<string, unknown>; meta: Record<string, unknown> }> {
    const cacheKey = `edgeone:zones:${providerId}:${offset}:${limit}`
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
      const response = await gateway.call('DescribeZones', { Offset: pageOffset, Limit: pageLimit })
      const parsed = edgeoneZoneListResponseSchema.parse(response)

      requestId = parsed.RequestId ?? undefined
      const pageItems = (parsed.Zones ?? [])
        .map((zone) => this.presentZone(edgeOneZoneSchema.parse(zone)))
        .filter((zone) => !['pages', 'ai'].includes(zone.type?.toLowerCase() ?? ''))
      items.push(...pageItems)

      hasMore = pageItems.length >= pageLimit
      pageOffset += pageItems.length
      const total = parsed.TotalCount ?? 0
      if (pageOffset >= total) hasMore = false
    }

    const total = items.length
    const paginated = items.slice(offset, offset + limit)
    const result = {
      items: paginated,
      pagination: { offset, limit, total },
      meta: { page: limit > 0 ? Math.floor(offset / limit) + 1 : 1, per_page: limit, offset, limit, total, total_pages: limit > 0 ? Math.ceil(total / limit) : 1 },
      request_id: requestId,
    }

    globalCache.set(cacheKey, result, TTL_MS, [`edgeone:zones:${providerId}`])
    return result
  }

  async zoneById(providerId: string, zoneId: string): Promise<EdgeOneZone> {
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const zones = await this.zones(providerId, offset, 100)
      for (const zone of zones.items) {
        if (zone.id === zoneId) return zone
      }
      hasMore = zones.items.length >= 100
      offset += 100
    }

    throw new ApiError('edgeone_zone_not_found', `EdgeOne zone ${zoneId} not found`, 404)
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

  private presentZone(zone: import('../schemas/response.js').EdgeOneZone): EdgeOneZone {
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
