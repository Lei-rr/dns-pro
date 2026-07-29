import { ProviderRepository } from '../../provider/repository.js'
import { CloudflareGateway } from '../gateways/gateway.js'
import { CacheTtl, buildCacheKey, pagePaginationMeta, providerCacheTag, withProviderCache, zoneCacheTag } from '../../../lib/cache/provider-cache.js'
import { emitCloudflareZoneMutated } from '../events.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { wrapProviderError } from '../../../lib/http/wrap-provider-error.js'
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
  constructor(private readonly providers: ProviderRepository) {}

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

        let response
        try {
          response = await gateway.get('zones', query)
        } catch (error) {
          throw wrapProviderError('cloudflare_zone_list_failed', 'Cloudflare zone list failed', providerId, error)
        }
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

  async listAll(providerId: string, refresh = false): Promise<ZoneListResult> {
    const pageSize = 100
    const items: ZonePresentation[] = []
    let page = 1

    while (true) {
      const result = await this.list(providerId, page, pageSize, '', refresh)
      items.push(...result.items)
      const totalPages = Number(result.pagination.total_pages ?? 0)
      if (totalPages > 0 ? page >= totalPages : result.items.length < pageSize) break
      page++
    }

    return {
      items,
      pagination: {
        page: 1,
        per_page: items.length,
        count: items.length,
        total_count: items.length,
        total_pages: 1,
      },
      meta: {
        page: 1,
        per_page: items.length,
        offset: 0,
        limit: items.length,
        count: items.length,
        total: items.length,
        total_pages: 1,
      },
    }
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

    let response
    try {
      response = await gateway.post('zones', body)
    } catch (error) {
      throw wrapProviderError('cloudflare_zone_create_failed', 'Cloudflare zone create failed', providerId, error, {
        zone: name,
      })
    }
    await emitCloudflareZoneMutated(providerId, name, 'create')

    return this.presentZone(parseCloudflareItemResponse(response, cloudflareZoneSchema).result)
  }

  async delete(providerId: string, zoneId: string): Promise<{ id: string }> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response
    try {
      response = await gateway.delete(`zones/${encodeURIComponent(zoneId)}`)
    } catch (error) {
      throw wrapProviderError('cloudflare_zone_delete_failed', 'Cloudflare zone delete failed', providerId, error, {
        zone: zoneId,
      })
    }
    await emitCloudflareZoneMutated(providerId, zoneId, 'delete')

    const parsed = parseCloudflareItemResponse(response, cloudflareIdResultSchema)
    return { id: parsed.result.id ?? zoneId }
  }

  async idByName(providerId: string, name: string, refresh = false): Promise<string> {
    const normalizedName = name.toLowerCase().trim()
    let page = 1
    let totalPages: number

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
        let response
        try {
          response = await gateway.get(`zones/${encodeURIComponent(zoneId)}/dcv_delegation/uuid`)
        } catch (error) {
          throw wrapProviderError('cloudflare_dcv_failed', 'Cloudflare DCV delegation fetch failed', providerId, error, {
            zone: zoneId,
          })
        }
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
    return CloudflareGateway.forToken(provider.api_token)
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
