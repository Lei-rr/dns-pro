import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import type { ZoneListPort } from '../../core/contracts/zone-list.port.js'
import { providerCacheTag, withProviderCache } from '../../core/cache/provider-cache.js'
import { ApiError } from '../../core/http/api-error.js'
import { parseBool } from '../../shared/values.js'
import { callProvider, collectOffsetPages, toFullListResult } from '../../core/providers/provider-call.js'
import { providerOptionalString, providerString } from '../../core/providers/provider-values.js'
import { edgeOneClientFor, resolveEdgeOneProvider } from './access.js'
import {
  edgeOneZoneSchema,
  edgeoneZoneListResponseSchema,
  type EdgeOneZone as RawZone,
} from './edge-one-response.schema.js'

// 不支持加速域名管理的站点类型
const HIDDEN_ZONE_TYPES = new Set(['pages', 'ai'])

interface EdgeOneZone {
  id: string
  name: string
  area?: string
  type?: string
  status?: string
  active_status?: string
  lock_status?: string
  paused?: boolean
  created_on?: string
  modified_on?: string
}

/** 与 core 的 toFullListResult 保持同一形状，避免各服务重复声明分页元数据 */
type ZoneListResult = ReturnType<typeof toFullListResult<EdgeOneZone>>

/** EdgeOne 站点查询（站点数量少，全量拉取）。读模型是端口 ZoneSummary 的超集 */
export class EdgeOneZoneService implements ZoneListPort {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly httpTimeoutMs?: number
  ) {}

  async zones(providerId: string, refresh = false): Promise<ZoneListResult> {
    const { dnspodProviderId } = await resolveEdgeOneProvider(this.providers, providerId)
    const cached = await withProviderCache<ZoneListResult>({
      key: `edgeone:zones:${providerId}:all`,
      // 站点列表只随服务商配置变化：provider 标签已覆盖变更/删除（原先的独立 tag 没有任何失效入口，已移除）
      tags: [providerCacheTag(providerId), providerCacheTag(dnspodProviderId)],
      refresh,
      loader: () => this.fetchAll(providerId),
    })
    return cached.value
  }

  async zoneById(providerId: string, zoneId: string, refresh = false): Promise<EdgeOneZone> {
    const zone = (await this.zones(providerId, refresh)).items.find((item) => item.id === zoneId)
    if (!zone) throw new ApiError('edgeone_zone_not_found', `EdgeOne zone ${zoneId} not found`, 404)
    return zone
  }

  private async fetchAll(providerId: string): Promise<ZoneListResult> {
    const client = await edgeOneClientFor(this.providers, providerId, this.httpTimeoutMs)
    const { items, requestId } = await collectOffsetPages(
      async (offset, limit) => {
        const response = await callProvider(
          { code: 'edgeone_zone_list_failed', message: 'EdgeOne zone list failed', providerId },
          () => client.call('DescribeZones', { Offset: offset, Limit: limit })
        )
        const parsed = edgeoneZoneListResponseSchema.parse(response)
        return {
          items: (parsed.Zones as unknown[])
            .map((zone) => presentZone(edgeOneZoneSchema.parse(zone)))
            .filter((zone) => !HIDDEN_ZONE_TYPES.has(String(zone.type ?? '').toLowerCase())),
          sourceCount: Number(parsed.SourceCount ?? 0),
          requestId: parsed.RequestId ?? undefined,
        }
      },
      { limitCode: 'edgeone_pagination_limit', limitMessage: 'EdgeOne pagination limit reached' }
    )
    return toFullListResult(items, requestId)
  }
}

function presentZone(zone: RawZone): EdgeOneZone {
  return {
    id: providerString(zone.ZoneId),
    name: providerString(zone.ZoneName),
    area: providerOptionalString(zone.Area),
    type: providerOptionalString(zone.Type),
    status: providerOptionalString(zone.Status),
    active_status: providerOptionalString(zone.ActiveStatus),
    lock_status: providerOptionalString(zone.LockStatus),
    paused: zone.Paused == null ? undefined : parseBool(zone.Paused),
    created_on: providerOptionalString(zone.CreatedOn),
    modified_on: providerOptionalString(zone.ModifiedOn),
  }
}
