import {
  invalidateProviderCache,
  recordCacheTag,
  recordLineCacheTag,
  zoneCacheTag,
} from '../../core/cache/provider-cache.js'

/** 缓存键与标签共用的服务商类型字面量：模块内只此一处，漂移只会静默失效缓存 */
export const DNSPOD_PROVIDER_TYPE = 'dnspod'

/** 记录变更：同时失效站点列表（站点数据包含 record_count） */
export function invalidateDnsPodRecordCache(providerId: string, zone: string): void {
  invalidateProviderCache({
    tags: [recordCacheTag(DNSPOD_PROVIDER_TYPE, providerId, zone), zoneCacheTag(DNSPOD_PROVIDER_TYPE, providerId)],
  })
}

export function invalidateDnsPodZoneCache(providerId: string, zone: string): void {
  invalidateProviderCache({
    tags: [
      zoneCacheTag(DNSPOD_PROVIDER_TYPE, providerId),
      recordCacheTag(DNSPOD_PROVIDER_TYPE, providerId, zone),
      recordLineCacheTag(DNSPOD_PROVIDER_TYPE, providerId, zone),
    ],
  })
}
