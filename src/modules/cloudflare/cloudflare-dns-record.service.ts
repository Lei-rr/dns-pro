import { ProviderRepository } from '../providers/provider.repository.js'
import { CloudflareGateway } from './cloudflare.client.js'
import {
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
  withProviderCache,
} from '../../platform/cache/provider-cache.js'
import { invalidateCloudflareRecordCache } from './cloudflare.cache.js'
import { wrapProviderError } from '../../shared/http/wrap-provider-error.js'
import type { CloudflareProvider } from '../providers/provider.types.js'
import {
  cloudflareDnsRecordSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from './cloudflare-response.schema.js'
import { parseBool } from '../../shared/lib/parse-bool.js'
import { providerNullableNumber, providerNullableString } from '../../shared/providers/provider-values.js'

const PROVIDER_TYPE = 'cloudflare'
const MAX_PROVIDER_PAGES = 1000

interface RecordPresentation {
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
  items: RecordPresentation[]
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

export interface RecordPayload {
  type: string
  name: string
  content: string
  ttl: number
  proxied?: boolean
  priority?: number
  comment?: string
}

interface RecordFilters {
  page?: number
  per_page?: number
  type?: string
  search?: string
  refresh?: boolean
}

function exactCloudflareRecords<T extends { name?: unknown; type?: unknown }>(
  records: T[],
  name: string,
  type: string
): T[] {
  const expectedName = name.toLowerCase().trim().replace(/\.$/, '')
  const expectedType = type.toUpperCase().trim()
  return records.filter((record) => {
    const recordName = String(record.name ?? '')
      .toLowerCase()
      .trim()
      .replace(/\.$/, '')
    return (
      recordName === expectedName &&
      String(record.type ?? '')
        .toUpperCase()
        .trim() === expectedType
    )
  })
}

export class CloudflareDnsRecordService {
  constructor(private readonly providers: ProviderRepository) {}

  async list(providerId: string, zoneId: string, filters: RecordFilters = {}): Promise<RecordListResult> {
    const normalized = this.normalizeFilters(filters)
    const cached = await withProviderCache<RecordListResult>({
      key: {
        prefix: `${PROVIDER_TYPE}:records`,
        parts: {
          provider_id: providerId,
          zone_id: zoneId,
          page: normalized.page,
          per_page: normalized.per_page,
          type: normalized.type,
          search: normalized.search,
        },
      },
      tags: [providerCacheTag(providerId), recordCacheTag(PROVIDER_TYPE, providerId, zoneId)],
      refresh: normalized.refresh,
      loader: async () => {
        const provider = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)

        const query: Record<string, unknown> = {
          page: normalized.page,
          per_page: normalized.per_page,
        }
        if (normalized.type !== '') {
          query.type = normalized.type
        }
        if (normalized.search !== '') {
          query.search = normalized.search
        }

        let response
        try {
          response = await gateway.get(`zones/${encodeURIComponent(zoneId)}/dns_records`, query)
        } catch (error) {
          throw wrapProviderError('cloudflare_record_list_failed', 'Cloudflare record list failed', providerId, error, {
            zone: zoneId,
          })
        }
        const parsed = parseCloudflareListResponse(response)
        const resultInfo = parsed.result_info
        return {
          items: parsed.result.map((record) => this.presentRecord(record)),
          pagination: {
            page: Number(resultInfo?.page ?? normalized.page),
            per_page: Number(resultInfo?.per_page ?? normalized.per_page),
            count: resultInfo?.count ?? parsed.source_count,
            total_count: resultInfo?.total_count ?? null,
            total_pages: resultInfo?.total_pages ?? null,
          },
          meta: pagePaginationMeta(resultInfo, normalized.page, normalized.per_page),
        }
      },
    })
    return cached.value
  }

  async listAll(providerId: string, zoneId: string, refresh = false): Promise<RecordListResult> {
    const pageSize = 100
    const items: RecordPresentation[] = []
    let page = 1

    while (true) {
      const result = await this.list(providerId, zoneId, { page, per_page: pageSize, refresh })
      items.push(...result.items)
      const totalPages = Number(result.pagination.total_pages ?? 0)
      const sourceCount = Number(result.pagination.count ?? result.items.length)
      if (totalPages > 0 ? page >= totalPages : sourceCount < pageSize) break
      if (page >= MAX_PROVIDER_PAGES) throw new Error('Cloudflare pagination limit reached')
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

  async findExact(
    providerId: string,
    zoneId: string,
    name: string,
    type: string,
    refresh = false
  ): Promise<RecordPresentation[]> {
    const matches: RecordPresentation[] = []
    let page = 1
    while (true) {
      const result = await this.list(providerId, zoneId, {
        type,
        search: name,
        page,
        per_page: 100,
        refresh,
      })
      matches.push(...exactCloudflareRecords(result.items, name, type))
      const totalPages = Number(result.pagination.total_pages ?? 0)
      const sourceCount = Number(result.pagination.count ?? result.items.length)
      if (totalPages > 0 ? page >= totalPages : sourceCount < 100) break
      if (page >= MAX_PROVIDER_PAGES) throw new Error('Cloudflare pagination limit reached')
      page++
    }
    return matches
  }

  async create(
    providerId: string,
    zoneId: string,
    data: RecordPayload | Record<string, unknown>
  ): Promise<RecordPresentation> {
    const normalized = this.normalizeRecordData(data)
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response
    try {
      response = await gateway.post(`zones/${encodeURIComponent(zoneId)}/dns_records`, this.recordPayload(normalized))
    } catch (error) {
      throw wrapProviderError('cloudflare_record_create_failed', 'Cloudflare record create failed', providerId, error, {
        zone: zoneId,
      })
    }

    const record = this.presentRecord(parseCloudflareItemResponse(response).result)
    await invalidateCloudflareRecordCache(providerId, zoneId)
    return record
  }

  async update(
    providerId: string,
    zoneId: string,
    recordId: string,
    data: RecordPayload | Record<string, unknown>
  ): Promise<RecordPresentation> {
    const normalized = this.normalizeRecordData(data)
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response
    try {
      response = await gateway.put(
        `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
        this.recordPayload(normalized)
      )
    } catch (error) {
      throw wrapProviderError('cloudflare_record_update_failed', 'Cloudflare record update failed', providerId, error, {
        zone: zoneId,
        record_id: recordId,
      })
    }

    const record = this.presentRecord(parseCloudflareItemResponse(response).result)
    await invalidateCloudflareRecordCache(providerId, zoneId)
    return record
  }

  async delete(providerId: string, zoneId: string, recordId: string): Promise<{ id: string }> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response
    try {
      response = await gateway.delete(`zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`)
    } catch (error) {
      throw wrapProviderError('cloudflare_record_delete_failed', 'Cloudflare record delete failed', providerId, error, {
        zone: zoneId,
        record_id: recordId,
      })
    }

    const parsed = parseCloudflareItemResponse(response)
    const id =
      typeof parsed.result.id === 'string' || typeof parsed.result.id === 'number' ? String(parsed.result.id) : recordId
    await invalidateCloudflareRecordCache(providerId, zoneId)
    return { id }
  }

  private normalizeFilters(filters: RecordFilters): Required<RecordFilters> {
    return {
      page: Math.max(1, Number(filters.page ?? 1)),
      per_page: Math.min(100, Math.max(1, Number(filters.per_page ?? 100))),
      type: String(filters.type ?? '')
        .toUpperCase()
        .trim(),
      search: String(filters.search ?? '').trim(),
      refresh: Boolean(filters.refresh ?? false),
    }
  }

  private normalizeRecordData(data: RecordPayload | Record<string, unknown>): RecordPayload {
    return {
      type: String(data.type).toUpperCase().trim(),
      name: String(data.name),
      content: String(data.content),
      ttl: Number(data.ttl ?? 1),
      proxied: data.proxied === undefined ? undefined : Boolean(data.proxied),
      priority: data.priority !== undefined ? Number(data.priority) : undefined,
      comment: data.comment === undefined ? undefined : String(data.comment),
    }
  }

  private recordPayload(data: RecordPayload): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      type: data.type,
      name: data.name,
      content: data.content,
      ttl: data.ttl,
    }

    for (const field of ['proxied', 'priority', 'comment'] as const) {
      if (data[field] !== undefined) {
        payload[field] = data[field]
      }
    }

    return payload
  }

  private presentRecord(record: unknown): RecordPresentation {
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
      tags: Array.isArray(r.tags) ? r.tags.filter((value: unknown): value is string => typeof value === 'string') : [],
      created_on: providerNullableString(r.created_on),
      modified_on: providerNullableString(r.modified_on),
    }
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
}
