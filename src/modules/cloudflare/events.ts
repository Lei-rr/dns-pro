import { eventBus } from '../../platform/events/event-bus.js'
import { recordCacheTag, zoneCacheTag } from '../../lib/cache/provider-cache.js'

const PROVIDER_TYPE = 'cloudflare'

export async function emitCloudflareRecordMutated(providerId: string, zoneId: string, action: string) {
  await eventBus.emit({
    type: 'record.mutated',
    provider_id: providerId,
    zone: zoneId,
    action: `cloudflare.record.${action}`,
    cache_tags: [recordCacheTag(PROVIDER_TYPE, providerId, zoneId)],
  })
}

export async function emitCloudflareZoneMutated(providerId: string, zone: string, action: string) {
  await eventBus.emit({
    type: 'zone.mutated',
    provider_id: providerId,
    zone,
    action: `cloudflare.zone.${action}`,
    cache_tags: [
      zoneCacheTag(PROVIDER_TYPE, providerId),
      recordCacheTag(PROVIDER_TYPE, providerId, zone),
    ],
  })
}
