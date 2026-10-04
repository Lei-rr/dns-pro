import { edgeoneDomainsCacheTag, invalidateProviderCache } from '../../core/cache/provider-cache.js'

export function invalidateEdgeOneDomainCache(providerId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [edgeoneDomainsCacheTag(providerId, zoneId)] })
}
