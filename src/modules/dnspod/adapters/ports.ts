import type { PageQuery, PageResult, RecordPort, ZonePort } from '../../../kernel/index.js'
import type { DnsPodZoneService } from '../services/zone-service.js'
import type { DnsPodRecordService } from '../services/record-service.js'
import { eventBus } from '../../../platform/events/event-bus.js'
import { providerCacheTag, recordCacheTag, zoneCacheTag } from '../../../lib/cache/provider-cache.js'

const PROVIDER_TYPE = 'dnspod'

export class DnsPodZonePortAdapter implements ZonePort {
  constructor(private readonly zones: DnsPodZoneService) {}

  async list(providerId: string, query: PageQuery = {}): Promise<PageResult<Record<string, unknown>>> {
    const result = await this.zones.list(providerId, {
      offset: query.offset ?? 0,
      limit: query.limit ?? query.perPage ?? 20,
      keyword: query.keyword,
      refresh: query.refresh,
    })
    return {
      items: result.items as unknown as Array<Record<string, unknown>>,
      pagination: result.pagination,
      meta: result.meta,
    }
  }
}

export class DnsPodRecordPortAdapter implements RecordPort {
  constructor(private readonly records: DnsPodRecordService) {}

  async list(
    providerId: string,
    zone: string,
    query: PageQuery & Record<string, unknown> = {},
  ): Promise<PageResult<Record<string, unknown>>> {
    const result = await this.records.list(providerId, zone, {
      offset: Number(query.offset ?? 0),
      limit: Number(query.limit ?? query.perPage ?? 20),
      subdomain: query.subdomain ? String(query.subdomain) : undefined,
      record_type: query.record_type ? String(query.record_type) : undefined,
      keyword: query.keyword ? String(query.keyword) : undefined,
      refresh: Boolean(query.refresh),
    })
    return {
      items: result.items as unknown as Array<Record<string, unknown>>,
      pagination: result.pagination,
      meta: result.meta,
    }
  }
}

export async function emitDnsPodRecordMutated(providerId: string, zone: string, action: string) {
  await eventBus.emit({
    type: 'record.mutated',
    provider_id: providerId,
    zone,
    action: `dnspod.record.${action}`,
    cache_tags: [recordCacheTag(PROVIDER_TYPE, providerId, zone), providerCacheTag(providerId)],
  })
}

export async function emitDnsPodZoneMutated(providerId: string, zone: string, action: string) {
  await eventBus.emit({
    type: 'zone.mutated',
    provider_id: providerId,
    zone,
    action: `dnspod.zone.${action}`,
    cache_tags: [
      zoneCacheTag(PROVIDER_TYPE, providerId),
      recordCacheTag(PROVIDER_TYPE, providerId, zone),
      providerCacheTag(providerId),
    ],
  })
}
