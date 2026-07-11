import { ProviderRepository } from '../../provider/repository.js'
import { CloudflareGateway } from '../gateways/gateway.js'
import { globalCache } from '../../../lib/cache/cache-service.js'
import type { CloudflareProvider } from '../../provider/types.js'
import {
  buildCacheKey,
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
} from '../../../lib/cache/cache-helpers.js'
import {
  cloudflareDnsRecordSchema,
  cloudflareIdResultSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../schemas/response.js'

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

    const response = await gateway.get(`zones/${encodeURIComponent(zoneId)}/dns_records`, query)
    const parsed = parseCloudflareListResponse(response, cloudflareDnsRecordSchema)
    const resultInfo = parsed.result_info
    const result: RecordListResult = {
      items: parsed.result.map((record) => this.presentRecord(record)),
      pagination: {
        page: Number(resultInfo?.page ?? normalized.page),
        per_page: Number(resultInfo?.per_page ?? normalized.per_page),
        count: resultInfo?.count ?? null,
        total_count: resultInfo?.total_count ?? null,
        total_pages: resultInfo?.total_pages ?? null,
      },
      meta: pagePaginationMeta(resultInfo, normalized.page, normalized.per_page),
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

    const response = await gateway.post(
      `zones/${encodeURIComponent(zoneId)}/dns_records`,
      this.recordPayload(normalized)
    )

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])
    return this.presentRecord(parseCloudflareItemResponse(response, cloudflareDnsRecordSchema).result)
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

    const response = await gateway.put(
      `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      this.recordPayload(normalized)
    )

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])
    return this.presentRecord(parseCloudflareItemResponse(response, cloudflareDnsRecordSchema).result)
  }

  async delete(providerId: string, zoneId: string, recordId: string): Promise<{ id: string }> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    const response = await gateway.delete(
      `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`
    )

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, zoneId)])
    const parsed = parseCloudflareItemResponse(response, cloudflareIdResultSchema)
    return { id: parsed.result.id ?? recordId }
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
    const r = cloudflareDnsRecordSchema.parse(record)
    return {
      id: r.id ?? null,
      zone_id: r.zone_id ?? null,
      zone_name: r.zone_name ?? null,
      name: r.name ?? null,
      type: r.type ?? null,
      content: r.content ?? null,
      ttl: r.ttl ?? null,
      proxied: r.proxied ?? null,
      proxiable: r.proxiable ?? null,
      priority: r.priority ?? null,
      comment: r.comment ?? null,
      tags: r.tags ?? [],
      created_on: r.created_on ?? null,
      modified_on: r.modified_on ?? null,
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
