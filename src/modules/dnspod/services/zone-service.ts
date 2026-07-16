import { ProviderRepository } from '../../provider/repository.js'
import { CacheTtl, invalidateProviderCache, offsetPaginationMeta, providerCacheTag, recordCacheTag, withProviderCache, zoneCacheTag } from '../../../lib/cache/provider-cache.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { DnsPodGateway } from '../gateways/gateway.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainInfoSchema,
  dnspodDomainListResponseSchema,
  dnspodDomainSchema,
} from '../../../lib/providers/dnspod-response.js'
import type { DnsPodProvider } from '../../provider/types.js'

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

    const cached = await withProviderCache({
      key: {
        prefix: `${PROVIDER_TYPE}:zones`,
        parts: { provider_id: providerId, offset, limit, keyword },
      },
      tags: [providerCacheTag(providerId), zoneCacheTag(PROVIDER_TYPE, providerId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const provider = await this.requireProvider(providerId)
        const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

        const payload: Record<string, unknown> = { Offset: offset, Limit: limit }
        if (keyword !== '') {
          payload.Keyword = keyword
        }

        let response: unknown
        try {
          response = await gateway.call('DescribeDomainList', payload)
        } catch (error) {
          throw this.wrapError('dnspod_zone_list_failed', 'DNSPod zone list failed', providerId, error)
        }

        const parsed = dnspodDomainListResponseSchema.parse(response)
        const rawDomainList = Array.isArray(parsed.DomainList) ? parsed.DomainList : []
        const domainList = rawDomainList.map((zone) => presentZone(dnspodDomainSchema.parse(zone)))
        const total = Number(parsed.DomainCountInfo?.DomainTotal ?? 0)

        const result: ZoneListResult = {
          items: domainList,
          pagination: {
            offset,
            limit,
            total,
          },
          request_id: parsed.RequestId ?? undefined,
          meta: offsetPaginationMeta({ offset, limit, total }),
        }
        return result
      },
    })

    return cached.value
  }

  async create(providerId: string, zone: string): Promise<ZoneCreateResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const domain = zone.toLowerCase().trim()

    let response: unknown
    try {
      response = await gateway.call('CreateDomain', { Domain: domain })
    } catch (error) {
      throw this.wrapError('dnspod_zone_create_failed', 'DNSPod zone create failed', providerId, error, { zone: domain })
    }

    await invalidateProviderCache([zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    const parsed = dnspodDomainCreateResponseSchema.parse(response)
    const domainInfo = dnspodDomainInfoSchema.parse(parsed.DomainInfo ?? {})
    return {
      id: domainInfo.Id ?? 0,
      name: domainInfo.Domain ?? domain,
      name_servers: domainInfo.GradeNsList ?? [],
      request_id: parsed.RequestId ?? undefined,
    }
  }

  async delete(providerId: string, zone: string): Promise<ZoneDeleteResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const domain = zone.toLowerCase().trim()

    let response: unknown
    try {
      response = await gateway.call('DeleteDomain', { Domain: domain })
    } catch (error) {
      throw this.wrapError('dnspod_zone_delete_failed', 'DNSPod zone delete failed', providerId, error, { zone: domain })
    }

    await invalidateProviderCache([zoneCacheTag(PROVIDER_TYPE, providerId), recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    const parsed = dnspodDomainCreateResponseSchema.parse(response)
    return {
      name: domain,
      request_id: parsed.RequestId ?? undefined,
    }
  }

  private async requireProvider(providerId: string): Promise<DnsPodProvider> {
    return this.providers.requireType<DnsPodProvider>(
      providerId,
      'dnspod',
      'DNSPod provider not found',
      'dnspod_provider_not_found'
    )
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

function presentZone(zone: import('../../../lib/providers/dnspod-response.js').DnspodDomain): ZoneListItem {
  return {
    id: zone.DomainId ?? 0,
    name: zone.Name ?? '',
    punycode: zone.Punycode ?? '',
    status: zone.Status ?? '',
    dns_status: zone.DnsStatus ?? zone.DNSStatus ?? null,
    grade: zone.Grade ?? '',
    grade_title: zone.GradeTitle ?? '',
    group_id: zone.GroupId ?? 0,
    record_count: zone.RecordCount ?? 0,
    ttl: zone.TTL ?? 0,
    remark: zone.Remark ?? '',
    effective_dns: zone.EffectiveDNS ?? [],
    created_on: zone.CreatedOn ?? '',
    updated_on: zone.UpdatedOn ?? '',
  }
}
