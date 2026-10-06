import {
  customHostnameDetailsCacheTag,
  customHostnameListCacheTag,
  fallbackOriginCacheTag,
  invalidateProviderCache,
} from '../../../core/cache/provider-cache.js'

/** 标签使用关联的 Cloudflare 服务商 ID 与站点 ID，而非 SaaS 拥有者 ID/名称 */

/** 失效单主机名详情缓存：批量任务中逐条写后使用，列表缓存留到任务结束统一失效 */
export function invalidateSaaSHostnameDetailsCache(cloudflareProviderId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [customHostnameDetailsCacheTag(cloudflareProviderId, zoneId)] })
}

/** 失效站点主机名列表与详情缓存：单条写路径与任务收尾使用（收尾重复清详情是幂等的） */
export function invalidateSaaSHostnameListAndDetailsCache(cloudflareProviderId: string, zoneId: string): void {
  invalidateProviderCache({
    tags: [
      customHostnameListCacheTag(cloudflareProviderId, zoneId),
      customHostnameDetailsCacheTag(cloudflareProviderId, zoneId),
    ],
  })
}

export function invalidateSaaSFallbackOriginCache(cloudflareProviderId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [fallbackOriginCacheTag(cloudflareProviderId, zoneId)] })
}
