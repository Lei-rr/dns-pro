import {
  customHostnameDetailsCacheTag,
  customHostnameListCacheTag,
  fallbackOriginCacheTag,
  invalidateProviderCache,
} from '../../platform/cache/provider-cache.js'

/** Tags use the linked Cloudflare provider id and zone id, not the SaaS owner id/name. */
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
