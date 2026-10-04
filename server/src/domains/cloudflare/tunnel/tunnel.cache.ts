import {
  cloudflaredTunnelConfigCacheTag,
  cloudflaredTunnelsCacheTag,
  invalidateProviderCache,
} from '../../../kernel/cache/provider-cache.js'

export function invalidateTunnelListCache(providerId: string): void {
  invalidateProviderCache({ tags: [cloudflaredTunnelsCacheTag(providerId)] })
}

export function invalidateTunnelRouteCache(providerId: string, tunnelId: string): void {
  invalidateProviderCache({ tags: [cloudflaredTunnelConfigCacheTag(providerId, tunnelId)] })
}
