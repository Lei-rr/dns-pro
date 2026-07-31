import type { ProviderRepository } from '../../provider/repository.js'
import type { CloudflareProvider } from '../../provider/types.js'
import { CloudflareGateway } from '../../cloudflare/gateways/gateway.js'
import { CacheTtl, fallbackOriginCacheTag, withProviderCache } from '../../../lib/cache/provider-cache.js'
import { invalidateProviderCache } from '../../../lib/cache/provider-cache.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { wrapProviderError } from '../../../lib/http/wrap-provider-error.js'
import {
  parseCloudflareItemResponse,
  type CloudflareFallbackOrigin,
} from '../../../lib/providers/cloudflare-response.js'

export type FallbackOriginInfo = { origin?: string | null; status?: string | null }

/** Cloudflare for SaaS fallback-origin API adapter. */
export class CloudflareFallbackOriginGateway {
  constructor(private readonly providers: ProviderRepository) {}

  async show(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<FallbackOriginInfo> {
    const cached = await withProviderCache<FallbackOriginInfo>({
      key: `cloudflare:fallback_origin:${cloudflareProviderId}:${zoneId}`,
      tags: [fallbackOriginCacheTag(cloudflareProviderId, zoneId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const gateway = await this.gateway(cloudflareProviderId)
        try {
          const response = await gateway.get(`zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`)
          return this.present(parseCloudflareItemResponse(response).result)
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 404) return this.present({})
          throw wrapProviderError(
            'saas_fallback_origin_show_failed',
            'Cloudflare fallback origin fetch failed',
            cloudflareProviderId,
            error,
            { zone: zoneId },
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
        { zone: zoneId },
      )
    }
    await this.invalidate(cloudflareProviderId, zoneId, 'fallback_origin_set')
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
        { zone: zoneId },
      )
    }
    await this.invalidate(cloudflareProviderId, zoneId, 'fallback_origin_delete')
    return this.present({})
  }

  private async gateway(providerId: string): Promise<CloudflareGateway> {
    const provider = await this.providers.requireType<CloudflareProvider>(providerId, 'cloudflare')
    return CloudflareGateway.forToken(provider.api_token)
  }

  private async invalidate(providerId: string, zoneId: string, _action: string): Promise<void> {
    invalidateProviderCache([fallbackOriginCacheTag(providerId, zoneId)])
  }

  private present(result: CloudflareFallbackOrigin): FallbackOriginInfo {
    const origin = typeof result.origin === 'string' || typeof result.origin === 'number'
      ? String(result.origin).trim()
      : ''
    const status = typeof result.status === 'string' || typeof result.status === 'number'
      ? String(result.status)
      : null
    return { origin: origin || null, status }
  }
}
