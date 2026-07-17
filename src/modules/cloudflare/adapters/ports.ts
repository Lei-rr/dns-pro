import type { PageQuery, PageResult, RecordPort, ZonePort } from '../../../contracts/index.js'
import type { CloudflareZoneService } from '../services/zone-service.js'
import type { CloudflareDnsRecordService } from '../services/dns-record-service.js'
import { eventBus } from '../../../platform/events/event-bus.js'
import { providerCacheTag, recordCacheTag, zoneCacheTag } from '../../../lib/cache/provider-cache.js'

const PROVIDER_TYPE = 'cloudflare'

export class CloudflareZonePortAdapter implements ZonePort {
  constructor(private readonly zones: CloudflareZoneService) {}

  async list(providerId: string, query: PageQuery = {}): Promise<PageResult<Record<string, unknown>>> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? query.limit ?? 20
    const result = await this.zones.list(providerId, page, perPage, query.keyword ?? '', Boolean(query.refresh))
    return {
      items: result.items as unknown as Array<Record<string, unknown>>,
      pagination: result.pagination,
      meta: result.meta,
    }
  }
}

export class CloudflareRecordPortAdapter implements RecordPort {
  constructor(private readonly records: CloudflareDnsRecordService) {}

  async list(
    providerId: string,
    zone: string,
    query: PageQuery & Record<string, unknown> = {},
  ): Promise<PageResult<Record<string, unknown>>> {
    const result = await this.records.list(providerId, zone, {
      page: Number(query.page ?? 1),
      per_page: Number(query.perPage ?? query.limit ?? 20),
      type: query.type ? String(query.type) : undefined,
      search: query.keyword ? String(query.keyword) : query.search ? String(query.search) : undefined,
      refresh: Boolean(query.refresh),
    })
    return {
      items: result.items as unknown as Array<Record<string, unknown>>,
      pagination: result.pagination,
      meta: result.meta,
    }
  }
}

export async function emitCloudflareRecordMutated(providerId: string, zoneId: string, action: string) {
  await eventBus.emit({
    type: 'record.mutated',
    provider_id: providerId,
    zone: zoneId,
    action: `cloudflare.record.${action}`,
    cache_tags: [recordCacheTag(PROVIDER_TYPE, providerId, zoneId), providerCacheTag(providerId)],
  })
}

export async function emitCloudflareZoneMutated(providerId: string, zone: string, action: string) {
  await eventBus.emit({
    type: 'zone.mutated',
    provider_id: providerId,
    zone,
    action: `cloudflare.zone.${action}`,
    cache_tags: [zoneCacheTag(PROVIDER_TYPE, providerId), providerCacheTag(providerId)],
  })
}
