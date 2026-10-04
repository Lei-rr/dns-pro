import { invalidateProviderCache, recordCacheTag, zoneCacheTag } from '../../platform/cache/provider-cache.js'

const PROVIDER_TYPE = 'cloudflare'

/** 记录缓存按 zoneId 打标签 */
export function invalidateCloudflareRecordCache(providerId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [recordCacheTag(PROVIDER_TYPE, providerId, zoneId)] })
}

/** 站点变更：清站点列表；删除站点时同时清该站点记录 */
export function invalidateCloudflareZoneCache(providerId: string, zoneId?: string): void {
  invalidateProviderCache({
    tags: [
      zoneCacheTag(PROVIDER_TYPE, providerId),
      ...(zoneId ? [recordCacheTag(PROVIDER_TYPE, providerId, zoneId)] : []),
    ],
  })
}
