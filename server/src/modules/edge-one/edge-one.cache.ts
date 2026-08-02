import { edgeoneDomainsCacheTag, invalidateProviderCache } from '../../platform/cache/provider-cache.js'

export function invalidateEdgeOneDomainCache(providerId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [edgeoneDomainsCacheTag(providerId, zoneId)] })
}
