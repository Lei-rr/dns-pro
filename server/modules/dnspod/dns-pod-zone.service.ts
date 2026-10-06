import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import { providerCacheTag, withProviderCache, zoneCacheTag } from '../../core/cache/provider-cache.js'
import {
  callProvider,
  collectOffsetPages,
  TENCENT_PAGE_SIZE,
  toFullListResult,
} from '../../core/providers/provider-call.js'
import {
  providerFiniteNumber,
  providerNullableString,
  providerOptionalString,
  providerString,
} from '../../core/providers/provider-values.js'
import { toAsciiFqdn } from '../../shared/values.js'
import { DNSPOD_PROVIDER_TYPE, invalidateDnsPodZoneCache } from './dns-pod.cache.js'
import { dnsPodClientFor } from './dns-pod.client.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainInfoSchema,
  dnspodDomainListResponseSchema,
  dnspodDomainSchema,
  dnspodMutationResponseSchema,
  type DnsPodDomain,
} from './dns-pod-response.schema.js'

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
  group_id: number
  record_count: number
  ttl: number
  remark: string
  effective_dns: string[]
  created_on: string
}

/** 与 core 的 toFullListResult 保持同一形状，避免各服务重复声明分页元数据 */
type ZoneListResult = ReturnType<typeof toFullListResult<ZoneListItem>>

/** DNSPod 域名（Zone）管理 */
export class DnsPodZoneService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly httpTimeoutMs?: number
  ) {}

  async list(providerId: string, filters: ZoneListFilters = {}): Promise<ZoneListResult> {
    const cached = await withProviderCache<ZoneListResult>({
      key: { prefix: `${DNSPOD_PROVIDER_TYPE}:zones`, parts: { provider_id: providerId } },
      tags: [providerCacheTag(providerId), zoneCacheTag(DNSPOD_PROVIDER_TYPE, providerId)],
      refresh: filters.refresh ?? false,
      loader: () => this.fetchAll(providerId),
    })
    return cached.value
  }

  async create(providerId: string, zone: string) {
    // IDN 与匹配侧同源：统一 punycode，保证缓存键与失效标签在 UI/同步两条路径上一致
    const domain = toAsciiFqdn(zone)
    const client = await dnsPodClientFor(this.providers, providerId, this.httpTimeoutMs)
    const response = await callProvider(
      {
        code: 'dnspod_zone_create_failed',
        message: 'DNSPod zone create failed',
        providerId,
        details: { zone: domain },
      },
      () => client.call('CreateDomain', { Domain: domain })
    )
    // 上游已受理：先失效缓存再解析响应体。解析失败（502）时缓存也必须已清，
    // 否则站点列表仍返回变更前快照，新建站点不可见
    invalidateDnsPodZoneCache(providerId, domain)
    const parsed = dnspodDomainCreateResponseSchema.parse(response)
    const info = dnspodDomainInfoSchema.parse(parsed.DomainInfo ?? {})
    return {
      id: providerFiniteNumber(info.Id),
      name: providerString(info.Domain, domain),
      // dnspodDomainInfoSchema 已把 GradeNsList 归一为字符串数组
      name_servers: info.GradeNsList as string[],
      request_id: providerOptionalString(parsed.RequestId),
    }
  }

  async delete(providerId: string, zone: string) {
    // 同上：失效标签必须与记录/线路缓存的键同源（punycode）
    const domain = toAsciiFqdn(zone)
    const client = await dnsPodClientFor(this.providers, providerId, this.httpTimeoutMs)
    const response = await callProvider(
      {
        code: 'dnspod_zone_delete_failed',
        message: 'DNSPod zone delete failed',
        providerId,
        details: { zone: domain },
      },
      () => client.call('DeleteDomain', { Domain: domain })
    )
    // 同 create：上游已受理，先失效再解析；否则解析失败时已删域名仍会被当成写入目标
    invalidateDnsPodZoneCache(providerId, domain)
    const parsed = dnspodMutationResponseSchema.parse(response)
    return { name: domain, request_id: providerOptionalString(parsed.RequestId) }
  }

  private async fetchAll(providerId: string): Promise<ZoneListResult> {
    const client = await dnsPodClientFor(this.providers, providerId, this.httpTimeoutMs)
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
}

function presentZone(zone: DnsPodDomain): ZoneListItem {
  return {
    id: providerFiniteNumber(zone.DomainId),
    name: providerString(zone.Name),
    punycode: providerString(zone.Punycode),
    status: providerString(zone.Status),
    dns_status: providerNullableString(zone.DnsStatus ?? zone.DNSStatus),
    grade: providerString(zone.Grade),
    group_id: providerFiniteNumber(zone.GroupId),
    record_count: providerFiniteNumber(zone.RecordCount),
    ttl: providerFiniteNumber(zone.TTL),
    remark: providerString(zone.Remark),
    // dnspodDomainSchema 已把 EffectiveDNS 归一为字符串数组，这里不再重复过滤
    effective_dns: zone.EffectiveDNS as string[],
    created_on: providerString(zone.CreatedOn),
  }
}
