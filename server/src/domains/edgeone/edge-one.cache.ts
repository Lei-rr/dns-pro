import { edgeoneDomainsCacheTag, invalidateProviderCache } from '../../kernel/cache/provider-cache.js'

export function invalidateEdgeOneDomainCache(providerId: string, zoneId: string): void {
  invalidateProviderCache({ tags: [edgeoneDomainsCacheTag(providerId, zoneId)] })
}
