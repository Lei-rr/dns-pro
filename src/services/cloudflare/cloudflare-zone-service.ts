import { ProviderRepository } from '../../repositories/provider-repository.js'
import { CloudflareGateway } from '../../gateways/cloudflare-gateway.js'
import { globalCache } from '../../support/cache-service.js'
import { ApiError } from '../../support/api-error.js'
import {
  buildCacheKey,
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
  zoneCacheTag,
} from '../../support/cache-helpers.js'
import type { CloudflareProvider } from '../../types/provider.js'

const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000
const PROVIDER_TYPE = 'cloudflare'

interface ZonePresentation {
  [key: string]: unknown
  id: string | null
  name: string | null
  status: string | null
  type: string | null
  paused: boolean | null
  account: unknown
  name_servers: string[]
  original_name_servers: string[]
  created_on: string | null
  modified_on: string | null
  activated_on: string | null
}

export interface ZoneListResult {
  items: ZonePresentation[]
  pagination: {
    page: number
    per_page: number
    count: number | null
    total_count: number | null
    total_pages: number | null
  }
  meta: {
    page: number
    per_page: number
    offset: number
    limit: number
    count: number | null
    total: number | null
    total_pages: number | null
  }
}

interface CreateZonePayload {
  name: string
  account: { id: string }
  type: string
}

export class CloudflareZoneService {
  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async list(
    providerId: string,
    page: number,
    perPage: number,
    name = '',
    refresh = false
  ): Promise<ZoneListResult> {
    const cacheKey = buildCacheKey(`${PROVIDER_TYPE}:zones`, {
      provider_id: providerId,
      page,
      per_page: perPage,
      name,
    })

    if (!refresh) {
      const cached = globalCache.get<ZoneListResult>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const query: Record<string, unknown> = { page, per_page: perPage }
    if (name !== '') {
      query.name = name
    }

    const payload = await gateway.get<unknown[]>('zones', query)
    const result: ZoneListResult = {
      items: (payload.result ?? []).map((zone) => this.presentZone(zone)),
      pagination: {
        page: Number((payload.result_info?.page ?? page) as number),
        per_page: Number((payload.result_info?.per_page ?? perPage) as number),
        count: payload.result_info?.count !== undefined ? Number(payload.result_info.count) : null,
        total_count:
          payload.result_info?.total_count !== undefined ? Number(payload.result_info.total_count) : null,
        total_pages:
          payload.result_info?.total_pages !== undefined ? Number(payload.result_info.total_pages) : null,
      },
      meta: pagePaginationMeta(payload.result_info as Record<string, unknown> | undefined, page, perPage),
    }

    globalCache.set(cacheKey, result, DEFAULT_TTL_MS, [
      providerCacheTag(providerId),
      zoneCacheTag(PROVIDER_TYPE, providerId),
    ])

    return result
  }

  async create(providerId: string, name: string, type = 'full'): Promise<ZonePresentation> {
    const provider = await this.requireProvider(providerId)
    const accountId = provider.account_id.trim()

    if (accountId === '') {
      throw new ApiError('cloudflare_account_id_required', 'Cloudflare account_id is required', 422)
    }

    const gateway = this.gatewayFor(provider)
    const body: CreateZonePayload = {
      name,
      account: { id: accountId },
      type,
    }

    const payload = await gateway.post<unknown>('zones', body)
    globalCache.invalidateTags([zoneCacheTag(PROVIDER_TYPE, providerId)])

    return this.presentZone(payload.result ?? {})
  }

  async delete(providerId: string, zoneId: string): Promise<{ id: string }> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const payload = await gateway.delete<Record<string, unknown>>(`zones/${encodeURIComponent(zoneId)}`)
    globalCache.invalidateTags([zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])

    return { id: String((payload.result?.id ?? zoneId) as string) }
  }

  async idByName(providerId: string, name: string, refresh = false): Promise<string> {
    const normalizedName = name.toLowerCase().trim()
    let page = 1
    let totalPages = 1

    do {
      const zones = await this.list(providerId, page, 100, normalizedName, refresh)
      totalPages = zones.meta.total_pages ?? 1

      for (const zone of zones.items) {
        if (String(zone.name ?? '').toLowerCase() === normalizedName && zone.id) {
          return zone.id
        }
      }

      page++
    } while (page <= totalPages)

    throw new ApiError('cloudflare_zone_not_found', 'Cloudflare zone not found', 404, {
      provider_id: providerId,
      name: normalizedName,
    })
  }

  async dcvDelegationUuid(providerId: string, zoneId: string, refresh = false): Promise<string> {
    const cacheKey = buildCacheKey(`${PROVIDER_TYPE}:dcv_delegation`, {
      provider_id: providerId,
      zone_id: zoneId,
    })

    if (!refresh) {
      const cached = globalCache.get<{ uuid: string }>(cacheKey)
      if (cached) return cached.uuid
    }

    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const payload = await gateway.get<{ uuid: string }>(`zones/${encodeURIComponent(zoneId)}/dcv_delegation/uuid`)
    const uuid = String((payload.result?.uuid ?? '') as string)

    globalCache.set(cacheKey, { uuid }, DEFAULT_TTL_MS, [
      providerCacheTag(providerId),
      zoneCacheTag(PROVIDER_TYPE, providerId),
    ])

    return uuid
  }

  private async requireProvider(providerId: string): Promise<CloudflareProvider> {
    return this.providers.requireType<CloudflareProvider>(
      providerId,
      'cloudflare',
      'Cloudflare provider not found',
      'cloudflare_provider_not_found'
    )
  }

  private gatewayFor(provider: CloudflareProvider): CloudflareGateway {
    return new CloudflareGateway(provider.api_token)
  }

  private presentZone(zone: unknown): ZonePresentation {
    const z = zone as Record<string, unknown>
    return {
      id: z.id !== undefined ? String(z.id) : null,
      name: z.name !== undefined ? String(z.name) : null,
      status: z.status !== undefined ? String(z.status) : null,
      type: z.type !== undefined ? String(z.type) : null,
      paused: typeof z.paused === 'boolean' ? z.paused : null,
      account: z.account ?? null,
      name_servers: Array.isArray(z.name_servers) ? z.name_servers.map(String) : [],
      original_name_servers: Array.isArray(z.original_name_servers) ? z.original_name_servers.map(String) : [],
      created_on: z.created_on !== undefined ? String(z.created_on) : null,
      modified_on: z.modified_on !== undefined ? String(z.modified_on) : null,
      activated_on: z.activated_on !== undefined ? String(z.activated_on) : null,
    }
  }
}
