import { ProviderRepository } from '../repositories/provider-repository.js'
import { CloudflareGateway } from './cloudflare-gateway.js'
import { globalCache } from '../support/cache-service.js'
import { ApiError } from '../support/api-error.js'

const TTL_MS = 3 * 24 * 60 * 60 * 1000

export interface CloudflareCustomHostname {
  id: string
  hostname: string
  status?: string
  custom_origin_server?: string | null
  ssl?: Record<string, unknown>
  ownership_verification?: Record<string, unknown>
  custom_metadata?: Record<string, unknown> | null
  [key: string]: unknown
}

export class CloudflareCustomHostnameGateway {
  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async list(cloudflareProviderId: string, zoneId: string, page = 1, perPage = 100, refresh = false): Promise<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown> }> {
    if (refresh) {
      globalCache.invalidateTags([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    }

    const cacheKey = `cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}:${page}:${perPage}`
    const cached = globalCache.get<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown> }>(cacheKey)
    if (cached) return cached

    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

    const response = await gateway.get<CloudflareCustomHostname[]>(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames`,
      { page, per_page: perPage }
    )

    const items = (response.result ?? []).map((hostname) => this.present(hostname))
    const result = {
      items,
      pagination: {
        page: (response.result_info?.page as number) ?? page,
        per_page: (response.result_info?.per_page as number) ?? perPage,
        total_count: response.result_info?.total_count,
        total_pages: response.result_info?.total_pages,
      },
    }

    globalCache.set(cacheKey, result, TTL_MS, [`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return result
  }

  async show(cloudflareProviderId: string, zoneId: string, hostnameId: string, refresh = false): Promise<CloudflareCustomHostname> {
    const cacheKey = `cloudflare:custom_hostname:${cloudflareProviderId}:${zoneId}:${hostnameId}`
    if (!refresh) {
      const cached = globalCache.get<CloudflareCustomHostname>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

    const response = await gateway.get<CloudflareCustomHostname>(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`
    )
    const result = this.present(response.result ?? {})
    globalCache.set(cacheKey, result, TTL_MS, [`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
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
    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

    const payload: Record<string, unknown> = { hostname: String(data.hostname ?? '').trim() }
    const ssl: Record<string, unknown> = { type: 'dv' }
    if (data.method) ssl.method = String(data.method)
    if (data.min_tls_version) ssl.settings = { min_tls_version: String(data.min_tls_version) }
    payload.ssl = ssl

    const customOrigin = String(data.custom_origin_server ?? '').trim()
    if (customOrigin) payload.custom_origin_server = customOrigin

    const response = await gateway.post<CloudflareCustomHostname>(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames`,
      payload
    )

    globalCache.invalidateTags([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.present(response.result ?? {})
  }

  async update(cloudflareProviderId: string, zoneId: string, hostnameId: string, data: Record<string, unknown>): Promise<CloudflareCustomHostname> {
    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

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

    const response = await gateway.patch<CloudflareCustomHostname>(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`,
      payload
    )

    globalCache.invalidateTags([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.present(response.result ?? {})
  }

  async delete(cloudflareProviderId: string, zoneId: string, hostnameId: string): Promise<{ id: string }> {
    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

    await gateway.delete<Record<string, unknown>>(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`
    )

    globalCache.invalidateTags([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return { id: hostnameId }
  }

  async fallbackOriginInfo(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<{ origin?: string | null; status?: string | null; [key: string]: unknown }> {
    const cacheKey = `cloudflare:fallback_origin:${cloudflareProviderId}:${zoneId}`
    if (!refresh) {
      const cached = globalCache.get<{ origin?: string | null; status?: string | null }>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

    let info: { origin?: string | null; status?: string | null }
    try {
      const response = await gateway.get<{ origin?: string; status?: string }>(
        `zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`
      )
      info = this.presentFallbackOrigin(response.result ?? {})
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        info = this.presentFallbackOrigin({})
      } else {
        throw error
      }
    }

    globalCache.set(cacheKey, info, TTL_MS, [`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return info
  }

  async setFallbackOrigin(cloudflareProviderId: string, zoneId: string, origin: string): Promise<{ origin?: string | null; status?: string | null }> {
    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

    const response = await gateway.put<{ origin?: string; status?: string }>(
      `zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`,
      { origin }
    )

    globalCache.invalidateTags([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.presentFallbackOrigin(response.result ?? {})
  }

  async deleteFallbackOrigin(cloudflareProviderId: string, zoneId: string): Promise<{ origin?: string | null; status?: string | null }> {
    const provider = await this.providers.requireType(cloudflareProviderId, 'cloudflare')
    const gateway = new CloudflareGateway((provider as unknown as Record<string, string>).api_token)

    await gateway.delete<Record<string, unknown>>(`zones/${encodeURIComponent(zoneId)}/custom_hostnames/fallback_origin`)
    globalCache.invalidateTags([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
    return this.presentFallbackOrigin({})
  }

  invalidate(cloudflareProviderId: string, zoneId: string): void {
    globalCache.invalidateTags([`cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}`])
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

  private present(hostname: Record<string, unknown>): CloudflareCustomHostname {
    const ssl = (hostname.ssl as Record<string, unknown>) ?? {}
    const certificates = Array.isArray(ssl.certificates) ? ssl.certificates : []
    const firstCert = (certificates[0] as Record<string, unknown>) ?? {}

    return {
      id: String(hostname.id ?? ''),
      hostname: String(hostname.hostname ?? ''),
      status: hostname.status as string | undefined,
      custom_origin_server: hostname.custom_origin_server as string | null | undefined,
      ssl: {
        ...ssl,
        expires_on: firstCert.expires_on ?? ssl.expires_on,
        issuer: firstCert.issuer ?? ssl.issuer,
      },
      ownership_verification: (hostname.ownership_verification as Record<string, unknown>) ?? {},
      custom_metadata: (hostname.custom_metadata as Record<string, unknown> | null) ?? null,
      ...hostname,
    }
  }

  private presentFallbackOrigin(result: Record<string, unknown>): { origin?: string | null; status?: string | null } {
    const origin = String(result.origin ?? '')
    return {
      origin: origin !== '' ? origin : null,
      status: (result.status as string) ?? null,
    }
  }
}
