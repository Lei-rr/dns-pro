import type { ProviderRepository } from '../../kernel/providers/provider.repository.js'
import { providerCacheTag, withProviderCache, zoneCacheTag } from '../../kernel/cache/provider-cache.js'
import {
  callProvider,
  collectOffsetPages,
  parseUpstreamTotal,
  TENCENT_PAGE_SIZE,
  toFullListResult,
  type FullListPagination,
} from '../../kernel/providers/provider-call.js'
import {
  providerFiniteNumber,
  providerNullableString,
  providerOptionalString,
  providerString,
} from '../../kernel/providers/provider-values.js'
import { invalidateDnsPodZoneCache } from './dns-pod.cache.js'
import { DnsPodClient, dnsPodClientFor } from './dns-pod.client.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainInfoSchema,
  dnspodDomainListResponseSchema,
  dnspodDomainSchema,
  dnspodMutationResponseSchema,
  type DnsPodDomain,
} from './dns-pod-response.schema.js'

const PROVIDER_TYPE = 'dnspod'

interface ZoneListFilters {
  refresh?: boolean
}

interface ZoneListItem {
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

interface ZoneListResult {
  items: ZoneListItem[]
  pagination: FullListPagination
  meta: FullListPagination
  request_id?: string
}

/** DNSPod 域名（Zone）管理 */
export class DnsPodZoneService {
  constructor(private readonly providers: ProviderRepository) {}

  async list(providerId: string, filters: ZoneListFilters = {}): Promise<ZoneListResult> {
    const cached = await withProviderCache<ZoneListResult>({
      key: { prefix: `${PROVIDER_TYPE}:zones`, parts: { provider_id: providerId } },
      tags: [providerCacheTag(providerId), zoneCacheTag(PROVIDER_TYPE, providerId)],
      refresh: filters.refresh ?? false,
      loader: () => this.fetchAll(providerId),
    })
    return cached.value
  }

  async create(providerId: string, zone: string) {
    const domain = zone.toLowerCase().trim()
    const client = await this.clientFor(providerId)
    const response = await callProvider(
      {
        code: 'dnspod_zone_create_failed',
        message: 'DNSPod zone create failed',
        providerId,
        details: { zone: domain },
      },
      () => client.call('CreateDomain', { Domain: domain })
    )
    const parsed = dnspodDomainCreateResponseSchema.parse(response)
    const info = dnspodDomainInfoSchema.parse(parsed.DomainInfo ?? {})
    invalidateDnsPodZoneCache(providerId, domain)
    return {
      id: providerFiniteNumber(info.Id),
      name: providerString(info.Domain, domain),
      name_servers: (info.GradeNsList as unknown[]).filter((value): value is string => typeof value === 'string'),
      request_id: providerOptionalString(parsed.RequestId),
    }
  }

  async delete(providerId: string, zone: string) {
    const domain = zone.toLowerCase().trim()
    const client = await this.clientFor(providerId)
    const response = await callProvider(
      {
        code: 'dnspod_zone_delete_failed',
        message: 'DNSPod zone delete failed',
        providerId,
        details: { zone: domain },
      },
      () => client.call('DeleteDomain', { Domain: domain })
    )
    const parsed = dnspodMutationResponseSchema.parse(response)
    invalidateDnsPodZoneCache(providerId, domain)
    return { name: domain, request_id: providerOptionalString(parsed.RequestId) }
  }

  private async fetchAll(providerId: string): Promise<ZoneListResult> {
    const client = await this.clientFor(providerId)
    const { items, requestId } = await collectOffsetPages(
      async (offset, limit) => {
        const response = await callProvider(
          { code: 'dnspod_zone_list_failed', message: 'DNSPod zone list failed', providerId },
          () => client.call('DescribeDomainList', { Offset: offset, Limit: limit })
        )
        const parsed = dnspodDomainListResponseSchema.parse(response)
        return {
          items: (parsed.DomainList as unknown[]).map((zone) => presentZone(dnspodDomainSchema.parse(zone))),
          sourceCount: Number(parsed.SourceCount ?? 0),
          total: parseUpstreamTotal(parsed.DomainCountInfo?.DomainTotal),
          requestId: parsed.RequestId,
        }
      },
      {
        pageSize: TENCENT_PAGE_SIZE,
        limitCode: 'dnspod_pagination_limit',
        limitMessage: 'DNSPod pagination limit reached',
      }
    )
    return toFullListResult(items, requestId)
  }

  private clientFor(providerId: string): Promise<DnsPodClient> {
    return dnsPodClientFor(this.providers, providerId)
  }
}

function presentZone(zone: DnsPodDomain): ZoneListItem {
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
    effective_dns: (zone.EffectiveDNS as unknown[]).filter((value): value is string => typeof value === 'string'),
    created_on: providerString(zone.CreatedOn),
    updated_on: providerString(zone.UpdatedOn),
  }
}
