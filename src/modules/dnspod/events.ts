import { eventBus } from '../../platform/events/event-bus.js'
import { recordCacheTag, zoneCacheTag } from '../../lib/cache/provider-cache.js'

const PROVIDER_TYPE = 'dnspod'

export async function emitDnsPodRecordMutated(providerId: string, zone: string, action: string) {
  await eventBus.emit({
    type: 'record.mutated',
    provider_id: providerId,
    zone,
    action: `dnspod.record.${action}`,
    cache_tags: [recordCacheTag(PROVIDER_TYPE, providerId, zone)],
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
    ],
  })
}
