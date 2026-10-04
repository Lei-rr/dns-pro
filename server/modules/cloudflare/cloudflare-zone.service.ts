import { buildCacheKey, providerCacheTag, withProviderCache, zoneCacheTag } from '../../core/cache/provider-cache.js'
import { ApiError } from '../../core/http/api-error.js'
import { normalizeFqdn, parseBool } from '../../shared/values.js'
import {
  callProvider,
  collectNumberedPages,
  toFullListResult,
  type FullListPagination,
} from '../../core/providers/provider-call.js'
import { providerNullableString } from '../../core/providers/provider-values.js'
import { invalidateCloudflareZoneCache } from './cloudflare.cache.js'
import type { CloudflareAccess } from './access.js'
import {
  cloudflareZoneSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
  type CloudflarePage,
} from './cloudflare-response.schema.js'

const PROVIDER_TYPE = 'cloudflare'
const PAGE_LIMIT = { limitCode: 'cloudflare_pagination_limit', limitMessage: 'Cloudflare pagination limit reached' }

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
  pagination: FullListPagination
  meta: FullListPagination
}

/** Cloudflare 站点（Zone）管理 */
export class CloudflareZoneService {
  constructor(private readonly access: CloudflareAccess) {}

  /** 单页查询（带缓存），name 为精确站点名过滤 */
  async page(providerId: string, page: number, perPage: number, name = '', refresh = false) {
    const cached = await withProviderCache<CloudflarePage<ZonePresentation>>({
      key: buildCacheKey(`${PROVIDER_TYPE}:zones`, { provider_id: providerId, page, per_page: perPage, name }),
      tags: [providerCacheTag(providerId), zoneCacheTag(PROVIDER_TYPE, providerId)],
      refresh,
      loader: async () => {
        const { client } = await this.access.forProvider(providerId)
        const response = await callProvider(
          { code: 'cloudflare_zone_list_failed', message: 'Cloudflare zone list failed', providerId },
          () => client.get('zones', { page, per_page: perPage, name: name || undefined })
        )
        return parseCloudflareListResponse(response, (zone) => presentZone(zone))
      },
    })
    return cached.value
  }

  /** 全量站点列表 */
  async listAll(providerId: string, refresh = false): Promise<ZoneListResult> {
    const items = await collectNumberedPages(
      (page, perPage) => this.page(providerId, page, perPage, '', refresh),
      PAGE_LIMIT
    )
    return toFullListResult(items)
  }

  async create(providerId: string, name: string): Promise<ZonePresentation> {
    const { provider, client } = await this.access.forProvider(providerId)
    const accountId = provider.account_id.trim()
    if (accountId === '') {
      throw new ApiError('cloudflare_account_id_required', 'Cloudflare account_id is required', 422)
    }
    const response = await callProvider(
      {
        code: 'cloudflare_zone_create_failed',
        message: 'Cloudflare zone create failed',
        providerId,
        details: { zone: name },
      },
      () => client.post('zones', { name, account: { id: accountId }, type: 'full' })
    )
    const zone = presentZone(parseCloudflareItemResponse(response).result)
    invalidateCloudflareZoneCache(providerId)
    return zone
  }

  async delete(providerId: string, zoneId: string): Promise<{ id: string }> {
    const { client } = await this.access.forProvider(providerId)
    const response = await callProvider(
      {
        code: 'cloudflare_zone_delete_failed',
        message: 'Cloudflare zone delete failed',
        providerId,
        details: { zone: zoneId },
      },
      () => client.delete(`zones/${encodeURIComponent(zoneId)}`)
    )
    const result = parseCloudflareItemResponse(response).result
    invalidateCloudflareZoneCache(providerId, zoneId)
    return { id: providerNullableString(result.id) ?? zoneId }
  }

  /** 站点名 → 站点 ID */
  async idByName(providerId: string, name: string, refresh = false): Promise<string> {
    const normalized = normalizeFqdn(name)
    let found = ''
    await collectNumberedPages((page, perPage) => this.page(providerId, page, perPage, normalized, refresh), {
      ...PAGE_LIMIT,
      stop: (items) => {
        found = items.find((zone) => normalizeFqdn(zone.name) === normalized && zone.id)?.id ?? ''
        return found !== ''
      },
    })
    if (found) return found
    throw new ApiError('cloudflare_zone_not_found', 'Cloudflare zone not found', 404, {
      provider_id: providerId,
      name: normalized,
    })
  }
}

function presentZone(zone: unknown): ZonePresentation {
  const z = cloudflareZoneSchema.parse(zone)
  return {
    id: providerNullableString(z.id),
    name: providerNullableString(z.name),
    status: providerNullableString(z.status),
    type: providerNullableString(z.type),
    paused: z.paused == null ? null : parseBool(z.paused),
    account: z.account && typeof z.account === 'object' && !Array.isArray(z.account) ? z.account : null,
    name_servers: z.name_servers.map(String),
    original_name_servers: z.original_name_servers.map(String),
    created_on: providerNullableString(z.created_on),
    modified_on: providerNullableString(z.modified_on),
    activated_on: providerNullableString(z.activated_on),
  }
}
