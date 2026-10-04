import { invalidateProviderCache, providerCacheTag } from '../cache/provider-cache.js'

/** 服务商配置变更：失效该服务商的全部缓存 */
export function invalidateProviderConfigCache(providerId: string): void {
  invalidateProviderCache({ tags: [providerCacheTag(providerId)] })
}
