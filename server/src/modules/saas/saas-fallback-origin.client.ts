import type { ProviderRepository } from '../providers/provider.repository.js'
import type { CloudflareProvider } from '../providers/provider.types.js'
import { CloudflareGateway } from '../cloudflare/cloudflare.client.js'
import { fallbackOriginCacheTag, providerCacheTag, withProviderCache } from '../../platform/cache/provider-cache.js'

import { wrapProviderError } from '../../shared/http/wrap-provider-error.js'
import { isExplicitNotFound } from '../../shared/providers/provider-error.js'
import { parseCloudflareItemResponse, type CloudflareFallbackOrigin } from '../cloudflare/cloudflare-response.schema.js'

export type FallbackOriginInfo = { origin?: string | null; status?: string | null }

/** Cloudflare for SaaS fallback-origin API adapter. */
export class CloudflareFallbackOriginGateway {
  constructor(private readonly providers: ProviderRepository) {}

  async show(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<FallbackOriginInfo> {
    const cached = await withProviderCache<FallbackOriginInfo>({
      key: `cloudflare:fallback_origin:${cloudflareProviderId}:${zoneId}`,
      tags: [providerCacheTag(cloudflareProviderId), fallbackOriginCacheTag(cloudflareProviderId, zoneId)],
      refresh,
      loader: async () => {
        const gateway = await this.gateway(cloudflareProviderId)
        try {
          const response = await gateway.get(`zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`)
          return this.present(parseCloudflareItemResponse(response).result)
        } catch (error) {
          if (isExplicitNotFound(error)) return this.present({})
          throw wrapProviderError(
            'saas_fallback_origin_show_failed',
            'Cloudflare fallback origin fetch failed',
            cloudflareProviderId,
            error,
            { zone: zoneId }
          )
        }
      },
    })
    return cached.value
  }

  async set(cloudflareProviderId: string, zoneId: string, origin: string): Promise<FallbackOriginInfo> {
    const gateway = await this.gateway(cloudflareProviderId)
    let response
    try {
      response = await gateway.put(`zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`, { origin })
    } catch (error) {
      throw wrapProviderError(
        'saas_fallback_origin_set_failed',
        'Cloudflare fallback origin update failed',
        cloudflareProviderId,
        error,
        { zone: zoneId }
      )
    }
    return this.present(parseCloudflareItemResponse(response).result)
  }

  async delete(cloudflareProviderId: string, zoneId: string): Promise<FallbackOriginInfo> {
    const gateway = await this.gateway(cloudflareProviderId)
    try {
      await gateway.delete(`zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`)
    } catch (error) {
      throw wrapProviderError(
        'saas_fallback_origin_delete_failed',
        'Cloudflare fallback origin delete failed',
        cloudflareProviderId,
        error,
        { zone: zoneId }
      )
    }
    return this.present({})
  }

  private async gateway(providerId: string): Promise<CloudflareGateway> {
    const provider = await this.providers.requireType<CloudflareProvider>(providerId, 'cloudflare')
    return CloudflareGateway.forToken(provider.api_token)
  }

  private present(result: CloudflareFallbackOrigin): FallbackOriginInfo {
    const origin =
      typeof result.origin === 'string' || typeof result.origin === 'number' ? String(result.origin).trim() : ''
    const status = typeof result.status === 'string' || typeof result.status === 'number' ? String(result.status) : null
    return { origin: origin || null, status }
  }
}
