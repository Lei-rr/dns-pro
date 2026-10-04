import { invalidateProviderCache, recordCacheTag, zoneCacheTag } from '../../core/cache/provider-cache.js'

/** 缓存键与标签共用的服务商类型字面量：模块内只此一处，漂移只会静默失效缓存 */
export const CLOUDFLARE_PROVIDER_TYPE = 'cloudflare'

/** 记录缓存按 zoneId 打标签 */
export function invalidateCloudflareRecordCache(providerId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [recordCacheTag(CLOUDFLARE_PROVIDER_TYPE, providerId, zoneId)] })
}

/** 站点变更：清站点列表；删除站点时同时清该站点记录 */
export function invalidateCloudflareZoneCache(providerId: string, zoneId?: string): void {
  invalidateProviderCache({
    tags: [
      zoneCacheTag(CLOUDFLARE_PROVIDER_TYPE, providerId),
      ...(zoneId ? [recordCacheTag(CLOUDFLARE_PROVIDER_TYPE, providerId, zoneId)] : []),
    ],
  })
}
