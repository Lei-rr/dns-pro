import { ProviderRepository } from '../../provider/repository.js'
import { CacheTtl, offsetPaginationMeta, providerCacheTag, withProviderCache, zoneCacheTag } from '../../../lib/cache/provider-cache.js'
import { emitDnsPodZoneMutated } from '../events.js'
import { wrapProviderError } from '../../../lib/http/wrap-provider-error.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { DnsPodGateway } from '../gateways/gateway.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainInfoSchema,
  dnspodDomainListResponseSchema,
  dnspodDomainSchema,
} from '../../../lib/providers/dnspod-response.js'
import type { DnsPodProvider } from '../../provider/types.js'
import { providerFiniteNumber, providerNullableString, providerOptionalString, providerString } from '../../../lib/providers/provider-values.js'

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
  constructor(private readonly providers: ProviderRepository) {}

  async list(providerId: string, filters: ZoneListFilters = {}): Promise<ZoneListResult> {
    const keyword = (filters.keyword ?? '').trim().toLowerCase()
    const refresh = filters.refresh ?? false
    const cached = await withProviderCache<ZoneListResult>({
      key: { prefix: `${PROVIDER_TYPE}:zones`, parts: { provider_id: providerId } },
      tags: [providerCacheTag(providerId), zoneCacheTag(PROVIDER_TYPE, providerId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const provider = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)
        const pageSize = 100
        const items: ZoneListItem[] = []
        let offset = 0
        let pages = 0
        let requestId: string | undefined

        while (true) {
          let response: unknown
          try {
            response = await gateway.call('DescribeDomainList', { Offset: offset, Limit: pageSize })
          } catch (error) {
            throw wrapProviderError('dnspod_zone_list_failed', 'DNSPod zone list failed', providerId, error)
          }
          const parsed = dnspodDomainListResponseSchema.parse(response)
          pages++
          const sourceCount = Number(parsed.SourceCount ?? 0)
          const pageItems = (Array.isArray(parsed.DomainList) ? parsed.DomainList : [])
            .map((zone) => presentZone(dnspodDomainSchema.parse(zone)))
          items.push(...pageItems)
          const totalRaw = parsed.DomainCountInfo?.DomainTotal
          const totalValue = Number(totalRaw)
          const total = totalRaw != null && totalRaw !== '' && Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : null
          requestId = parsed.RequestId ?? requestId
          offset += sourceCount
          if (sourceCount < pageSize || (total !== null && offset >= total)) break
          if (pages >= 1000) throw new ApiError('dnspod_pagination_limit', 'DNSPod pagination limit reached', 502)
        }

        return {
          items,
          pagination: { offset: 0, limit: items.length, total: items.length },
          request_id: requestId,
          meta: offsetPaginationMeta({ offset: 0, limit: items.length || 1, total: items.length }),
        }
      },
    })

    if (!keyword) return cached.value
    const items = cached.value.items.filter((zone) => zone.name.toLowerCase().includes(keyword))
    return {
      ...cached.value,
      items,
      pagination: { offset: 0, limit: items.length, total: items.length },
      meta: offsetPaginationMeta({ offset: 0, limit: items.length || 1, total: items.length }),
    }
  }

  async create(providerId: string, zone: string): Promise<ZoneCreateResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const domain = zone.toLowerCase().trim()

    let response: unknown
    try {
      response = await gateway.call('CreateDomain', { Domain: domain })
    } catch (error) {
      throw wrapProviderError('dnspod_zone_create_failed', 'DNSPod zone create failed', providerId, error, { zone: domain })
    }

    const parsed = dnspodDomainCreateResponseSchema.parse(response)
    const domainInfo = dnspodDomainInfoSchema.parse(parsed.DomainInfo ?? {})
    const result = {
      id: providerFiniteNumber(domainInfo.Id),
      name: providerString(domainInfo.Domain, domain),
      name_servers: Array.isArray(domainInfo.GradeNsList) ? domainInfo.GradeNsList.filter((value: unknown): value is string => typeof value === 'string') : [],
      request_id: providerOptionalString(parsed.RequestId),
    }
    await emitDnsPodZoneMutated(providerId, domain, 'create')
    return result
  }

  async delete(providerId: string, zone: string): Promise<ZoneDeleteResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const domain = zone.toLowerCase().trim()

    let response: unknown
    try {
      response = await gateway.call('DeleteDomain', { Domain: domain })
    } catch (error) {
      throw wrapProviderError('dnspod_zone_delete_failed', 'DNSPod zone delete failed', providerId, error, { zone: domain })
    }

    const parsed = dnspodDomainCreateResponseSchema.parse(response)
    const result = {
      name: domain,
      request_id: providerOptionalString(parsed.RequestId),
    }
    await emitDnsPodZoneMutated(providerId, domain, 'delete')
    return result
  }

  private async requireProvider(providerId: string): Promise<DnsPodProvider> {
    return this.providers.requireType<DnsPodProvider>(
      providerId,
      'dnspod',
      'DNSPod provider not found',
      'dnspod_provider_not_found'
    )
  }


  private gatewayFor(provider: DnsPodProvider): DnsPodGateway {
    return DnsPodGateway.forCredentials({
      secretId: provider.secret_id,
      secretKey: provider.secret_key,
    })
  }
}

function presentZone(zone: import('../../../lib/providers/dnspod-response.js').DnspodDomain): ZoneListItem {
  return {
    id: providerFiniteNumber(zone.DomainId),
    name: providerString(zone.Name),
    punycode: providerString(zone.Punycode),
    status: providerString(zone.Status),
    dns_status: providerNullableString(zone.DnsStatus ?? zone.DNSStatus),
    grade: providerString(zone.Grade),
    grade_title: providerString(zone.GradeTitle),
    group_id: providerFiniteNumber(zone.GroupId),
    record_count: providerFiniteNumber(zone.RecordCount),
    ttl: providerFiniteNumber(zone.TTL),
    remark: providerString(zone.Remark),
    effective_dns: Array.isArray(zone.EffectiveDNS) ? zone.EffectiveDNS.filter((value: unknown): value is string => typeof value === 'string') : [],
    created_on: providerString(zone.CreatedOn),
    updated_on: providerString(zone.UpdatedOn),
  }
}
