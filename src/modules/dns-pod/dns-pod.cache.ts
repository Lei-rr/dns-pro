import { invalidateProviderCache, recordCacheTag, zoneCacheTag } from '../../platform/cache/provider-cache.js'

const PROVIDER_TYPE = 'dnspod'

export function invalidateDnsPodRecordCache(providerId: string, zone: string): void {
  invalidateProviderCache({ tags: [recordCacheTag(PROVIDER_TYPE, providerId, zone)] })
}

export function invalidateDnsPodZoneCache(providerId: string, zone: string): void {
  invalidateProviderCache({
    tags: [zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, zone)],
  })
}
