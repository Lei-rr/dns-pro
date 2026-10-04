import {
  customHostnameDetailsCacheTag,
  customHostnameListCacheTag,
  fallbackOriginCacheTag,
  invalidateProviderCache,
} from '../../../core/cache/provider-cache.js'

/** 标签使用关联的 Cloudflare 服务商 ID 与站点 ID，而非 SaaS 拥有者 ID/名称 */

/** 失效单主机名详情缓存：批量任务中逐条更新后使用，列表缓存留到任务结束统一失效 */
export function invalidateSaaSHostnameDetailsCache(cloudflareProviderId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [customHostnameDetailsCacheTag(cloudflareProviderId, zoneId)] })
}

export function invalidateSaaSHostnameCache(
  cloudflareProviderId: string,
  zoneId: string,
  includeDetails: boolean
): void {
  invalidateProviderCache({
    tags: [
      customHostnameListCacheTag(cloudflareProviderId, zoneId),
      ...(includeDetails ? [customHostnameDetailsCacheTag(cloudflareProviderId, zoneId)] : []),
    ],
  })
}

export function invalidateSaaSFallbackOriginCache(cloudflareProviderId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [fallbackOriginCacheTag(cloudflareProviderId, zoneId)] })
}
