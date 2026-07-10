import { ProviderRepository } from '../../repositories/provider-repository.js'
import { CloudflareGateway } from '../../gateways/cloudflare-gateway.js'
import { globalCache } from '../../support/cache-service.js'
import type { CloudflareProvider } from '../../types/provider.js'
import {
  buildCacheKey,
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
} from '../../support/cache-helpers.js'

const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000
const PROVIDER_TYPE = 'cloudflare'

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

interface RecordPayload {
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

export class CloudflareDnsRecordService {
  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async list(providerId: string, zoneId: string, filters: RecordFilters = {}): Promise<RecordListResult> {
    const normalized = this.normalizeFilters(filters)
    const cacheKey = buildCacheKey(`${PROVIDER_TYPE}:records`, {
      provider_id: providerId,
      zone_id: zoneId,
      page: normalized.page,
      per_page: normalized.per_page,
      type: normalized.type,
      search: normalized.search,
    })

    if (!normalized.refresh) {
      const cached = globalCache.get<RecordListResult>(cacheKey)
      if (cached) return cached
    }

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

    const payload = await gateway.get<unknown[]>(`zones/${encodeURIComponent(zoneId)}/dns_records`, query)
    const result: RecordListResult = {
      items: (payload.result ?? []).map((record) => this.presentRecord(record)),
      pagination: {
        page: Number((payload.result_info?.page ?? normalized.page) as number),
        per_page: Number((payload.result_info?.per_page ?? normalized.per_page) as number),
        count: payload.result_info?.count !== undefined ? Number(payload.result_info.count) : null,
        total_count:
          payload.result_info?.total_count !== undefined ? Number(payload.result_info.total_count) : null,
        total_pages:
          payload.result_info?.total_pages !== undefined ? Number(payload.result_info.total_pages) : null,
      },
      meta: pagePaginationMeta(payload.result_info as Record<string, unknown> | undefined, normalized.page, normalized.per_page),
    }

    globalCache.set(cacheKey, result, DEFAULT_TTL_MS, [
      providerCacheTag(providerId),
      recordCacheTag(PROVIDER_TYPE, providerId, zoneId),
    ])

    return result
  }

  async create(providerId: string, zoneId: string, data: RecordPayload): Promise<RecordPresentation> {
    const normalized = this.normalizeRecordData(data)
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const payload = await gateway.post<unknown>(
      `zones/${encodeURIComponent(zoneId)}/dns_records`,
      this.recordPayload(normalized) as Record<string, unknown>
    )

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])
    return this.presentRecord(payload.result ?? {})
  }

  async update(
    providerId: string,
    zoneId: string,
    recordId: string,
    data: RecordPayload
  ): Promise<RecordPresentation> {
    const normalized = this.normalizeRecordData(data)
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const payload = await gateway.put<unknown>(
      `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      this.recordPayload(normalized) as Record<string, unknown>
    )

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])
    return this.presentRecord(payload.result ?? {})
  }

  async delete(providerId: string, zoneId: string, recordId: string): Promise<{ id: string }> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const payload = await gateway.delete<Record<string, unknown>>(
      `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`
    )

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])
    return { id: String((payload.result?.id ?? recordId) as string) }
  }

  private normalizeFilters(filters: RecordFilters): Required<RecordFilters> {
    return {
      page: Math.max(1, Number(filters.page ?? 1)),
      per_page: Math.min(100, Math.max(1, Number(filters.per_page ?? 100))),
      type: String(filters.type ?? '').toUpperCase().trim(),
      search: String(filters.search ?? '').trim(),
      refresh: Boolean(filters.refresh ?? false),
    }
  }

  private normalizeRecordData(data: RecordPayload): RecordPayload {
    return {
      type: String(data.type).toUpperCase().trim(),
      name: String(data.name),
      content: String(data.content),
      ttl: Number(data.ttl ?? 1),
      proxied: data.proxied,
      priority: data.priority !== undefined ? Number(data.priority) : undefined,
      comment: data.comment,
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
    const r = record as Record<string, unknown>
    return {
      id: r.id !== undefined ? String(r.id) : null,
      zone_id: r.zone_id !== undefined ? String(r.zone_id) : null,
      zone_name: r.zone_name !== undefined ? String(r.zone_name) : null,
      name: r.name !== undefined ? String(r.name) : null,
      type: r.type !== undefined ? String(r.type) : null,
      content: r.content !== undefined ? String(r.content) : null,
      ttl: r.ttl !== undefined ? Number(r.ttl) : null,
      proxied: typeof r.proxied === 'boolean' ? r.proxied : null,
      proxiable: typeof r.proxiable === 'boolean' ? r.proxiable : null,
      priority: r.priority !== undefined ? Number(r.priority) : null,
      comment: r.comment !== undefined ? String(r.comment) : null,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      created_on: r.created_on !== undefined ? String(r.created_on) : null,
      modified_on: r.modified_on !== undefined ? String(r.modified_on) : null,
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
    return new CloudflareGateway(provider.api_token)
  }
}
