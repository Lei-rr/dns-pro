import { ProviderRepository } from '../../repositories/provider-repository.js'
import { globalCache } from '../../support/cache-service.js'
import { ApiError } from '../../support/api-error.js'
import {
  buildCacheKey,
  offsetPaginationMeta,
  providerCacheTag,
  recordCacheTag,
  zoneCacheTag,
} from '../../support/cache-helpers.js'
import { DnsPodGateway } from '../../gateways/dnspod-gateway.js'
import type { DnsPodProvider } from '../../types/provider.js'

const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000
const PROVIDER_TYPE = 'dnspod'

export interface ZoneListFilters {
  offset?: number
  limit?: number
  keyword?: string
  refresh?: boolean
}

export interface ZoneListItem {
  id: number
  name: string
  punycode: string
  status: string
  dns_status: string | null
  grade: string
  grade_title: string
  group_id: number
  record_count: number
  ttl: number
  remark: string
  effective_dns: string[]
  created_on: string
  updated_on: string
}

export interface ZoneListResult {
  items: ZoneListItem[]
  pagination: {
    offset: number
    limit: number
    total: number
  }
  request_id?: string
  meta: ReturnType<typeof offsetPaginationMeta>
}

export interface ZoneCreateResult {
  id: number
  name: string
  name_servers: string[]
  request_id?: string
}

export interface ZoneDeleteResult {
  name: string
  request_id?: string
}

export class DnsPodZoneService {
  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async list(providerId: string, filters: ZoneListFilters = {}): Promise<ZoneListResult> {
    const offset = Math.max(0, filters.offset ?? 0)
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
    const keyword = (filters.keyword ?? '').trim()
    const refresh = filters.refresh ?? false

    const cacheKey = buildCacheKey(`${PROVIDER_TYPE}:zones`, {
      provider_id: providerId,
      offset,
      limit,
      keyword,
    })

    if (!refresh) {
      const cached = globalCache.get<ZoneListResult>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const payload: Record<string, unknown> = { Offset: offset, Limit: limit }
    if (keyword !== '') {
      payload.Keyword = keyword
    }

    let response: Record<string, unknown>
    try {
      response = await gateway.call<Record<string, unknown>>('DescribeDomainList', payload)
    } catch (error) {
      throw this.wrapError('dnspod_zone_list_failed', 'DNSPod zone list failed', providerId, error)
    }

    const domainList = ((response.DomainList ?? []) as Record<string, unknown>[]).map(presentZone)
    const total = Number((response.DomainCountInfo as Record<string, unknown> | undefined)?.DomainTotal ?? 0)

    const result: ZoneListResult = {
      items: domainList,
      pagination: {
        offset,
        limit,
        total,
      },
      request_id: response.RequestId as string | undefined,
      meta: offsetPaginationMeta({ offset, limit, total }),
    }

    globalCache.set(cacheKey, result, DEFAULT_TTL_MS, [
      providerCacheTag(providerId),
      zoneCacheTag(PROVIDER_TYPE, providerId),
    ])

    return result
  }

  async create(providerId: string, zone: string): Promise<ZoneCreateResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const domain = zone.toLowerCase().trim()

    let response: Record<string, unknown>
    try {
      response = await gateway.call<Record<string, unknown>>('CreateDomain', { Domain: domain })
    } catch (error) {
      throw this.wrapError('dnspod_zone_create_failed', 'DNSPod zone create failed', providerId, error, { zone: domain })
    }

    globalCache.invalidateTags([zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    const domainInfo = response.DomainInfo as Record<string, unknown> | undefined
    return {
      id: Number(domainInfo?.Id ?? 0),
      name: String(domainInfo?.Domain ?? domain),
      name_servers: (domainInfo?.GradeNsList as string[] | undefined) ?? [],
      request_id: response.RequestId as string | undefined,
    }
  }

  async delete(providerId: string, zone: string): Promise<ZoneDeleteResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const domain = zone.toLowerCase().trim()

    let response: Record<string, unknown>
    try {
      response = await gateway.call<Record<string, unknown>>('DeleteDomain', { Domain: domain })
    } catch (error) {
      throw this.wrapError('dnspod_zone_delete_failed', 'DNSPod zone delete failed', providerId, error, { zone: domain })
    }

    globalCache.invalidateTags([zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    return {
      name: domain,
      request_id: response.RequestId as string | undefined,
    }
  }

  private async requireProvider(providerId: string): Promise<DnsPodProvider> {
    const provider = await this.providers.requireType(
      providerId,
      'dnspod',
      'DNSPod provider not found',
      'dnspod_provider_not_found'
    )
    return provider as unknown as DnsPodProvider
  }

  private wrapError(
    code: string,
    message: string,
    providerId: string,
    error: unknown,
    details: Record<string, unknown> = {}
  ): ApiError {
    if (error instanceof ApiError) {
      return error
    }
    const err = error instanceof Error ? error : new Error(String(error))
    return new ApiError(
      code,
      message,
      502,
      {
        ...details,
        provider_id: providerId,
        error: err.message,
      }
    )
  }
}

function presentZone(zone: Record<string, unknown>): ZoneListItem {
  return {
    id: Number(zone.DomainId ?? 0),
    name: String(zone.Name ?? ''),
    punycode: String(zone.Punycode ?? ''),
    status: String(zone.Status ?? ''),
    dns_status:
      zone.DnsStatus !== undefined
        ? String(zone.DnsStatus)
        : zone.DNSStatus !== undefined
          ? String(zone.DNSStatus)
          : null,
    grade: String(zone.Grade ?? ''),
    grade_title: String(zone.GradeTitle ?? ''),
    group_id: Number(zone.GroupId ?? 0),
    record_count: Number(zone.RecordCount ?? 0),
    ttl: Number(zone.TTL ?? 0),
    remark: String(zone.Remark ?? ''),
    effective_dns: (zone.EffectiveDNS as string[] | undefined) ?? [],
    created_on: String(zone.CreatedOn ?? ''),
    updated_on: String(zone.UpdatedOn ?? ''),
  }
}
