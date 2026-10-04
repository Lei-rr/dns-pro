import {
  invalidateProviderCache,
  recordCacheTag,
  recordLineCacheTag,
  zoneCacheTag,
} from '../../core/cache/provider-cache.js'

const PROVIDER_TYPE = 'dnspod'

/** 记录变更：同时失效站点列表（站点数据包含 record_count） */
export function invalidateDnsPodRecordCache(providerId: string, zone: string): void {
  invalidateProviderCache({
    tags: [recordCacheTag(PROVIDER_TYPE, providerId, zone), zoneCacheTag(PROVIDER_TYPE, providerId)],
  })
}

export function invalidateDnsPodZoneCache(providerId: string, zone: string): void {
  invalidateProviderCache({
    tags: [
      zoneCacheTag(PROVIDER_TYPE, providerId),
      recordCacheTag(PROVIDER_TYPE, providerId, zone),
      recordLineCacheTag(PROVIDER_TYPE, providerId, zone),
    ],
  })
}
