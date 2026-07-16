import { ProviderRepository } from '../../provider/repository.js'
import { CloudflareGateway } from '../../cloudflare/gateways/gateway.js'
import { CacheTtl, globalCache, invalidateProviderCache } from '../../../lib/cache/provider-cache.js'
import { ApiError } from '../../../lib/http/api-error.js'
import {
  cloudflareCustomHostnameSchema,
  cloudflareFallbackOriginSchema,
  cloudflareResultInfoSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../../../lib/providers/cloudflare-response.js'
import type { CloudflareProvider } from '../../provider/types.js'

export interface CloudflareCustomHostnameSslDcvDelegationRecord {
  cname: string
  cname_target: string
  [key: string]: unknown
}

export interface CloudflareCustomHostnameSsl {
  type?: string
  method?: string
  status?: string
  dcv_delegation_uuid?: string
  dcv_delegation_records?: CloudflareCustomHostnameSslDcvDelegationRecord[]
  certificates?: Record<string, unknown>[]
  expires_on?: string
  issuer?: string
  settings?: Record<string, unknown>
  [key: string]: unknown
}

export interface CloudflareCustomHostnameOwnership {
  type?: string
  name?: string
  value?: string
  [key: string]: unknown
}

export interface CloudflareCustomHostname {
  id: string
  hostname: string
  status?: string
  custom_origin_server?: string | null
  ssl?: CloudflareCustomHostnameSsl
  ownership_verification?: CloudflareCustomHostnameOwnership | null
  custom_metadata?: Record<string, unknown> | null
  previous_status?: string
  [key: string]: unknown
}

export class CloudflareCustomHostnameGateway {
  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async list(cloudflareProviderId: string, zoneId: string, page = 1, perPage = 100, refresh = false): Promise<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown> }> {
    if (refresh) {
      invalidateProviderCache([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    }

    const cacheKey = `cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}:${page}:${perPage}`
    const cached = globalCache.get<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown> }>(cacheKey)
    if (cached) return cached

    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    const response = await gateway.get(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames`,
      { page, per_page: perPage }
    )

    const parsed = parseCloudflareListResponse(response, cloudflareCustomHostnameSchema)
    const resultInfo = parsed.result_info ?? cloudflareResultInfoSchema.parse({})
    const items = parsed.result.map((hostname) => this.present(hostname))
    const result = {
      items,
      pagination: {
        page: resultInfo.page ?? page,
        per_page: resultInfo.per_page ?? perPage,
        total_count: resultInfo.total_count,
        total_pages: resultInfo.total_pages,
      },
    }

    globalCache.set(cacheKey, result, CacheTtl.providerData, [`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return result
  }

  async show(cloudflareProviderId: string, zoneId: string, hostnameId: string, refresh = false): Promise<CloudflareCustomHostname> {
    const cacheKey = `cloudflare:custom_hostname:${cloudflareProviderId}:${zoneId}:${hostnameId}`
    if (!refresh) {
      const cached = globalCache.get<CloudflareCustomHostname>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    const response = await gateway.get(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`
    )
    const result = this.present(parseCloudflareItemResponse(response, cloudflareCustomHostnameSchema).result)
    globalCache.set(cacheKey, result, CacheTtl.providerData, [`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return result
  }

  async idByHostname(cloudflareProviderId: string, zoneId: string, hostnameFqdn: string, refresh = false): Promise<string> {
    const normalized = decodeURIComponent(hostnameFqdn).toLowerCase().trim()

    const found = await this.findIdInList(cloudflareProviderId, zoneId, normalized, refresh)
    if (found) return found

    if (!refresh) {
      const refreshed = await this.findIdInList(cloudflareProviderId, zoneId, normalized, true)
      if (refreshed) return refreshed
    }

    throw new ApiError('saas_hostname_not_found', `Hostname ${hostnameFqdn} not found`, 404)
  }

  async create(cloudflareProviderId: string, zoneId: string, data: Record<string, unknown>): Promise<CloudflareCustomHostname> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    const payload: Record<string, unknown> = { hostname: String(data.hostname ?? '').trim() }
    const ssl: Record<string, unknown> = { type: 'dv' }
    if (data.method) ssl.method = String(data.method)
    if (data.min_tls_version) ssl.settings = { min_tls_version: String(data.min_tls_version) }
    payload.ssl = ssl

    const customOrigin = String(data.custom_origin_server ?? '').trim()
    if (customOrigin) payload.custom_origin_server = customOrigin

    const response = await gateway.post(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames`,
      payload
    )

    invalidateProviderCache([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.present(parseCloudflareItemResponse(response, cloudflareCustomHostnameSchema).result)
  }

  async update(cloudflareProviderId: string, zoneId: string, hostnameId: string, data: Record<string, unknown>): Promise<CloudflareCustomHostname> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    const payload: Record<string, unknown> = {}
    if (Object.prototype.hasOwnProperty.call(data, 'custom_origin_server')) {
      const customOrigin = String(data.custom_origin_server ?? '').trim()
      payload.custom_origin_server = customOrigin !== '' ? customOrigin : null
    }

    const ssl: Record<string, unknown> = {}
    if (data.method) ssl.method = String(data.method)
    if (data.min_tls_version) ssl.settings = { min_tls_version: String(data.min_tls_version) }
    if (Object.keys(ssl).length > 0) {
      ssl.type = 'dv'
      payload.ssl = ssl
    }

    const response = await gateway.patch(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`,
      payload
    )

    invalidateProviderCache([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.present(parseCloudflareItemResponse(response, cloudflareCustomHostnameSchema).result)
  }

  async delete(cloudflareProviderId: string, zoneId: string, hostnameId: string): Promise<{ id: string }> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    await gateway.delete(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`
    )

    invalidateProviderCache([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return { id: hostnameId }
  }

  async fallbackOriginInfo(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<{ origin?: string | null; status?: string | null; [key: string]: unknown }> {
    const cacheKey = `cloudflare:fallback_origin:${cloudflareProviderId}:${zoneId}`
    if (!refresh) {
      const cached = globalCache.get<{ origin?: string | null; status?: string | null }>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    let info: { origin?: string | null; status?: string | null }
    try {
      const response = await gateway.get(
        `zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`
      )
      info = this.presentFallbackOrigin(parseCloudflareItemResponse(response, cloudflareFallbackOriginSchema).result)
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        info = this.presentFallbackOrigin({})
      } else {
        throw error
      }
    }

    globalCache.set(cacheKey, info, CacheTtl.providerData, [`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return info
  }

  async setFallbackOrigin(cloudflareProviderId: string, zoneId: string, origin: string): Promise<{ origin?: string | null; status?: string | null }> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    const response = await gateway.put(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`,
      { origin }
    )

    invalidateProviderCache([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.presentFallbackOrigin(parseCloudflareItemResponse(response, cloudflareFallbackOriginSchema).result)
  }

  async deleteFallbackOrigin(cloudflareProviderId: string, zoneId: string): Promise<{ origin?: string | null; status?: string | null }> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway(provider.api_token)

    await gateway.delete(`zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`)
    invalidateProviderCache([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.presentFallbackOrigin({})
  }

  invalidate(cloudflareProviderId: string, zoneId: string): void {
    invalidateProviderCache([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
  }

  private async findIdInList(cloudflareProviderId: string, zoneId: string, fqdn: string, refresh: boolean): Promise<string | null> {
    let page = 1
    let hasMore = true
    while (hasMore) {
      const result = await this.list(cloudflareProviderId, zoneId, page, 100, refresh)
      for (const item of result.items) {
        if (item.hostname.toLowerCase() === fqdn && item.id) {
          return item.id
        }
      }
      const totalPages = Number(result.pagination.total_pages ?? 1)
      hasMore = page < totalPages
      page++
    }
    return null
  }

  private present(hostname: unknown): CloudflareCustomHostname {
    const parsed = cloudflareCustomHostnameSchema.parse(hostname)
    const sslInput = (parsed.ssl && typeof parsed.ssl === 'object' ? parsed.ssl : {}) as Record<string, any>
    const certificates = Array.isArray(sslInput.certificates) ? sslInput.certificates : []
    const firstCert =
      certificates[0] && typeof certificates[0] === 'object' ? (certificates[0] as Record<string, any>) : {}

    const ssl: CloudflareCustomHostnameSsl = {
      ...sslInput,
      expires_on: (firstCert.expires_on ?? sslInput.expires_on) as string | undefined,
      issuer: (firstCert.issuer ?? sslInput.issuer) as string | undefined,
    }

    return {
      ...parsed,
      id: parsed.id ?? '',
      hostname: parsed.hostname ?? '',
      status: parsed.status ?? undefined,
      custom_origin_server: parsed.custom_origin_server,
      ssl,
      ownership_verification: parsed.ownership_verification ?? {},
      custom_metadata: parsed.custom_metadata ?? null,
    }
  }

  private presentFallbackOrigin(result: import('../../../lib/providers/cloudflare-response.js').CloudflareFallbackOrigin): { origin?: string | null; status?: string | null } {
    const origin = String(result.origin ?? '')
    return {
      origin: origin !== '' ? origin : null,
      status: result.status ?? null,
    }
  }
}
