import { ProviderRepository } from '../../provider/repository.js'
import { CloudflareGateway } from '../gateways/gateway.js'
import { CacheTtl, buildCacheKey, invalidateProviderCache, pagePaginationMeta, providerCacheTag, recordCacheTag, withProviderCache, zoneCacheTag } from '../../../lib/cache/provider-cache.js'
import { ApiError } from '../../../lib/http/api-error.js'
import type { CloudflareProvider } from '../../provider/types.js'
import {
  cloudflareDcvDelegationSchema,
  cloudflareIdResultSchema,
  cloudflareZoneSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../../../lib/providers/cloudflare-response.js'

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
    const cached = await withProviderCache<ZoneListResult>({
      key: buildCacheKey(`${PROVIDER_TYPE}:zones`, {
      provider_id: providerId,
      page,
      per_page: perPage,
      name,
    }),
      tags: [
      providerCacheTag(providerId),
      zoneCacheTag(PROVIDER_TYPE, providerId),
    ],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const provider = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)

        const query: Record<string, unknown> = { page, per_page: perPage }
        if (name !== '') {
          query.name = name
        }

        const response = await gateway.get('zones', query)
        const parsed = parseCloudflareListResponse(response, cloudflareZoneSchema)
        const resultInfo = parsed.result_info
        const result: ZoneListResult = {
          items: parsed.result.map((zone) => this.presentZone(zone)),
          pagination: {
            page: Number(resultInfo?.page ?? page),
            per_page: Number(resultInfo?.per_page ?? perPage),
            count: resultInfo?.count ?? null,
            total_count: resultInfo?.total_count ?? null,
            total_pages: resultInfo?.total_pages ?? null,
          },
          meta: pagePaginationMeta(resultInfo, page, perPage),
        }
        return result
      },
    })

    return cached.value
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

    const response = await gateway.post('zones', body)
    await invalidateProviderCache([zoneCacheTag(PROVIDER_TYPE, providerId)])

    return this.presentZone(parseCloudflareItemResponse(response, cloudflareZoneSchema).result)
  }

  async delete(providerId: string, zoneId: string): Promise<{ id: string }> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const response = await gateway.delete(`zones/${encodeURIComponent(zoneId)}`)
    await invalidateProviderCache([zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])

    const parsed = parseCloudflareItemResponse(response, cloudflareIdResultSchema)
    return { id: parsed.result.id ?? zoneId }
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
    const cached = await withProviderCache<{ uuid: string }>({
      key: {
        prefix: `${PROVIDER_TYPE}:dcv_delegation`,
        parts: { provider_id: providerId, zone_id: zoneId },
      },
      tags: [providerCacheTag(providerId), zoneCacheTag(PROVIDER_TYPE, providerId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const provider = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)
        const response = await gateway.get(`zones/${encodeURIComponent(zoneId)}/dcv_delegation/uuid`)
        const uuid = parseCloudflareItemResponse(response, cloudflareDcvDelegationSchema).result.uuid ?? ''
        return { uuid }
      },
    })
    return cached.value.uuid
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
    const z = cloudflareZoneSchema.parse(zone)
    return {
      id: z.id ?? null,
      name: z.name ?? null,
      status: z.status ?? null,
      type: z.type ?? null,
      paused: z.paused ?? null,
      account: z.account ?? null,
      name_servers: z.name_servers ?? [],
      original_name_servers: z.original_name_servers ?? [],
      created_on: z.created_on ?? null,
      modified_on: z.modified_on ?? null,
      activated_on: z.activated_on ?? null,
    }
  }
}
