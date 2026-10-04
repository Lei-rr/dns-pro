import type { ProviderRepository } from '../providers/provider.repository.js'
import {
  buildCacheKey,
  providerCacheTag,
  recordCacheTag,
  withProviderCache,
} from '../../platform/cache/provider-cache.js'
import { parseBool, toAsciiFqdn } from '../../shared/lib/values.js'
import {
  callProvider,
  collectNumberedPages,
  toFullListResult,
  type FullListPagination,
} from '../../shared/providers/provider-call.js'
import { providerNullableNumber, providerNullableString } from '../../shared/providers/provider-values.js'
import { invalidateCloudflareRecordCache } from './cloudflare.cache.js'
import { cloudflareClientFor } from './cloudflare.client.js'
import {
  cloudflareDnsRecordSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
  type CloudflarePage,
} from './cloudflare-response.schema.js'

const PROVIDER_TYPE = 'cloudflare'
const PAGE_LIMIT = { limitCode: 'cloudflare_pagination_limit', limitMessage: 'Cloudflare pagination limit reached' }

export interface CloudflareRecord {
  [key: string]: unknown
  id: string | null
  zone_id: string | null
  zone_name: string | null
  name: string | null
  type: string | null
  content: string | null
  ttl: number | null
  proxied: boolean | null
  proxiable: boolean | null
  priority: number | null
  comment: string | null
  tags: string[]
  created_on: string | null
  modified_on: string | null
}

interface RecordListResult {
  items: CloudflareRecord[]
  pagination: FullListPagination
  meta: FullListPagination
}

export interface RecordPayload {
  type: string
  name: string
  content: string
  ttl: number
  proxied?: boolean
  priority?: number
  comment?: string
}

interface PageFilters {
  type?: string
  /** 精确匹配记录名（Cloudflare name 参数），用于同步前的查找 */
  name?: string
  refresh?: boolean
}

const recordPath = (zoneId: string, recordId?: string) =>
  `zones/${encodeURIComponent(zoneId)}/dns_records${recordId ? `/${encodeURIComponent(recordId)}` : ''}`

/** Cloudflare DNS 记录 CRUD（参数为 zoneId） */
export class CloudflareDnsRecordService {
  constructor(private readonly providers: ProviderRepository) {}

  /** 全量记录列表 */
  async listAll(providerId: string, zoneId: string, refresh = false): Promise<RecordListResult> {
    const items = await collectNumberedPages(
      (page, perPage) => this.page(providerId, zoneId, page, perPage, { refresh }),
      PAGE_LIMIT
    )
    return toFullListResult(items)
  }

  /**
   * 精确匹配 名称+类型：过滤下推到 Cloudflare（name + type），且不经过列表缓存，
   * 保证同步/删除前读到的是最新状态。
   */
  async findExact(providerId: string, zoneId: string, name: string, type: string): Promise<CloudflareRecord[]> {
    // Cloudflare 以 punycode 返回域名，含非 ASCII 时先转换再精确匹配
    const expectedName = toAsciiFqdn(name)
    const expectedType = type.trim().toUpperCase()
    const items = await collectNumberedPages(
      (page, perPage) => this.fetchPage(providerId, zoneId, page, perPage, { type: expectedType, name: expectedName }),
      PAGE_LIMIT
    )
    return items.filter(
      (record) => toAsciiFqdn(record.name) === expectedName && String(record.type ?? '').toUpperCase() === expectedType
    )
  }

  async create(providerId: string, zoneId: string, data: RecordPayload | Record<string, unknown>) {
    const { client } = await cloudflareClientFor(this.providers, providerId)
    const response = await callProvider(
      {
        code: 'cloudflare_record_create_failed',
        message: 'Cloudflare record create failed',
        providerId,
        details: { zone: zoneId },
      },
      () => client.post(recordPath(zoneId), toRecordPayload(data))
    )
    invalidateCloudflareRecordCache(providerId, zoneId)
    return presentRecord(parseCloudflareItemResponse(response).result)
  }

  async update(providerId: string, zoneId: string, recordId: string, data: RecordPayload | Record<string, unknown>) {
    const { client } = await cloudflareClientFor(this.providers, providerId)
    const response = await callProvider(
      {
        code: 'cloudflare_record_update_failed',
        message: 'Cloudflare record update failed',
        providerId,
        details: { zone: zoneId, record_id: recordId },
      },
      () => client.put(recordPath(zoneId, recordId), toRecordPayload(data))
    )
    invalidateCloudflareRecordCache(providerId, zoneId)
    return presentRecord(parseCloudflareItemResponse(response).result)
  }

  async delete(providerId: string, zoneId: string, recordId: string): Promise<{ id: string }> {
    const { client } = await cloudflareClientFor(this.providers, providerId)
    const response = await callProvider(
      {
        code: 'cloudflare_record_delete_failed',
        message: 'Cloudflare record delete failed',
        providerId,
        details: { zone: zoneId, record_id: recordId },
      },
      () => client.delete(recordPath(zoneId, recordId))
    )
    invalidateCloudflareRecordCache(providerId, zoneId)
    return { id: providerNullableString(parseCloudflareItemResponse(response).result.id) ?? recordId }
  }

  /** 带缓存的整页查询（UI 全量列表用） */
  private async page(
    providerId: string,
    zoneId: string,
    page: number,
    perPage: number,
    filters: PageFilters
  ): Promise<CloudflarePage<CloudflareRecord>> {
    const cached = await withProviderCache<CloudflarePage<CloudflareRecord>>({
      key: buildCacheKey(`${PROVIDER_TYPE}:records`, {
        provider_id: providerId,
        zone_id: zoneId,
        page,
        per_page: perPage,
      }),
      tags: [providerCacheTag(providerId), recordCacheTag(PROVIDER_TYPE, providerId, zoneId)],
      refresh: filters.refresh ?? false,
      loader: () => this.fetchPage(providerId, zoneId, page, perPage, filters),
    })
    return cached.value
  }

  /** 直连上游的单页查询（不读写缓存） */
  private async fetchPage(
    providerId: string,
    zoneId: string,
    page: number,
    perPage: number,
    filters: PageFilters
  ): Promise<CloudflarePage<CloudflareRecord>> {
    const { client } = await cloudflareClientFor(this.providers, providerId)
    const response = await callProvider(
      {
        code: 'cloudflare_record_list_failed',
        message: 'Cloudflare record list failed',
        providerId,
        details: { zone: zoneId },
      },
      () =>
        client.get(recordPath(zoneId), {
          page,
          per_page: perPage,
          type: (filters.type ?? '').trim().toUpperCase() || undefined,
          name: filters.name || undefined,
        })
    )
    return parseCloudflareListResponse(response, presentRecord)
  }
}

function toRecordPayload(data: RecordPayload | Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: String(data.type).trim().toUpperCase(),
    name: String(data.name),
    content: String(data.content),
    ttl: Number(data.ttl ?? 1) || 1,
  }
  if (data.proxied !== undefined) payload.proxied = Boolean(data.proxied)
  if (data.priority !== undefined) payload.priority = Number(data.priority)
  if (data.comment !== undefined) payload.comment = String(data.comment)
  return payload
}

function presentRecord(record: unknown): CloudflareRecord {
  const r = cloudflareDnsRecordSchema.parse(record)
  return {
    id: providerNullableString(r.id),
    zone_id: providerNullableString(r.zone_id),
    zone_name: providerNullableString(r.zone_name),
    name: providerNullableString(r.name),
    type: providerNullableString(r.type),
    content: providerNullableString(r.content),
    ttl: providerNullableNumber(r.ttl),
    proxied: r.proxied == null ? null : parseBool(r.proxied),
    proxiable: r.proxiable == null ? null : parseBool(r.proxiable),
    priority: providerNullableNumber(r.priority),
    comment: providerNullableString(r.comment),
    tags: r.tags,
    created_on: providerNullableString(r.created_on),
    modified_on: providerNullableString(r.modified_on),
  }
}
