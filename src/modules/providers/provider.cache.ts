import { invalidateProviderCache, providerCacheTag } from '../../platform/cache/provider-cache.js'

export function invalidateProviderConfigurationCache(providerId: string): void {
  invalidateProviderCache({ tags: [providerCacheTag(providerId)] })
}
