import { invalidateProviderCache, recordCacheTag, zoneCacheTag } from '../../platform/cache/provider-cache.js'

const PROVIDER_TYPE = 'cloudflare'

export function invalidateCloudflareRecordCache(providerId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [recordCacheTag(PROVIDER_TYPE, providerId, zoneId)] })
}

export function invalidateCloudflareZoneCache(providerId: string, zone: string): void {
  invalidateProviderCache({
    tags: [zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, zone)],
  })
}
