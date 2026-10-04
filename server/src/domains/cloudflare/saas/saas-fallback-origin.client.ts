import type { CloudflareAccess } from '../access.js'
import { parseCloudflareItemResponse, type CloudflareFallbackOrigin } from '../cloudflare-response.schema.js'
import { fallbackOriginCacheTag, providerCacheTag, withProviderCache } from '../../../kernel/cache/provider-cache.js'
import { isExplicitNotFound } from '../../../kernel/providers/provider-error.js'
import { callProvider, wrapProviderError } from '../../../kernel/providers/provider-call.js'
import { providerNullableString } from '../../../kernel/providers/provider-values.js'
import { invalidateSaaSFallbackOriginCache } from './saas.cache.js'

export type FallbackOriginInfo = { origin: string | null; status: string | null }

const fallbackPath = (zoneId: string) => `zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`

/** Cloudflare for SaaS 默认回源（Fallback Origin）API */
export class SaaSFallbackOriginClient {
  constructor(private readonly access: CloudflareAccess) {}

  async show(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<FallbackOriginInfo> {
    const cached = await withProviderCache<FallbackOriginInfo>({
      key: `cloudflare:fallback_origin:${cloudflareProviderId}:${zoneId}`,
      tags: [providerCacheTag(cloudflareProviderId), fallbackOriginCacheTag(cloudflareProviderId, zoneId)],
      refresh,
      loader: async () => {
        const { client } = await this.access.forProvider(cloudflareProviderId)
        try {
          return presentFallback(parseCloudflareItemResponse(await client.get(fallbackPath(zoneId))).result)
        } catch (error) {
          // 未设置时上游返回 404
          if (isExplicitNotFound(error)) return presentFallback({})
          throw wrapProviderError(
            'saas_fallback_origin_show_failed',
            'Cloudflare fallback origin fetch failed',
            cloudflareProviderId,
            error,
            {
              zone: zoneId,
            }
          )
        }
      },
    })
    return cached.value
  }

  async set(cloudflareProviderId: string, zoneId: string, origin: string): Promise<FallbackOriginInfo> {
    const { client } = await this.access.forProvider(cloudflareProviderId)
    const response = await callProvider(
      {
        code: 'saas_fallback_origin_set_failed',
        message: 'Cloudflare fallback origin update failed',
        providerId: cloudflareProviderId,
        details: { zone: zoneId },
      },
      () => client.put(fallbackPath(zoneId), { origin })
    )
    invalidateSaaSFallbackOriginCache(cloudflareProviderId, zoneId)
    return presentFallback(parseCloudflareItemResponse(response).result)
  }

  async delete(cloudflareProviderId: string, zoneId: string): Promise<FallbackOriginInfo> {
    const { client } = await this.access.forProvider(cloudflareProviderId)
    await callProvider(
      {
        code: 'saas_fallback_origin_delete_failed',
        message: 'Cloudflare fallback origin delete failed',
        providerId: cloudflareProviderId,
        details: { zone: zoneId },
      },
      () => client.delete(fallbackPath(zoneId))
    )
    invalidateSaaSFallbackOriginCache(cloudflareProviderId, zoneId)
    return presentFallback({})
  }
}

function presentFallback(result: CloudflareFallbackOrigin): FallbackOriginInfo {
  return {
    origin: providerNullableString(result.origin)?.trim() || null,
    status: providerNullableString(result.status),
  }
}
