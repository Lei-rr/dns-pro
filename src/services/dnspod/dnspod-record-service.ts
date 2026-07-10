import { ProviderRepository } from '../../repositories/provider-repository.js'
import { globalCache } from '../../support/cache-service.js'
import { ApiError } from '../../support/api-error.js'
import { DnsPodGateway } from '../../gateways/dnspod-gateway.js'
import { dnspodRecordSchema } from '../../schemas/dnspod-responses.js'
import type { DnsPodProvider } from '../../types/provider.js'
import {
  providerCacheTag,
  recordCacheTag,
  buildCacheKey,
  offsetPaginationMeta,
} from '../../support/cache-helpers.js'

const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000
const PROVIDER_TYPE = 'dnspod'

export interface RecordListFilters {
  offset?: number
  limit?: number
  subdomain?: string
  record_type?: string
  keyword?: string
  refresh?: boolean
}

export interface RecordListItem {
  id: number
  name: string
  type: string
  value: string
  line: string
  line_id: string
  status: string
  ttl: number
  mx: number
  weight: number
  monitor_status: string
  remark: string
  default_ns: boolean
  updated_on: string
}

export interface RecordListResult {
  items: RecordListItem[]
  pagination: {
    offset: number
    limit: number
    count: number
    total: number
  }
  request_id?: string
  meta: ReturnType<typeof offsetPaginationMeta>
}

export interface RecordCreateInput {
  record_type: string
  record_line: string
  value: string
  subdomain?: string
  record_line_id?: string
  mx?: number
  ttl?: number
  weight?: number
  status?: 'ENABLE' | 'DISABLE'
  remark?: string
}

export interface RecordMutationResult {
  id: number
  request_id?: string
}

export class DnsPodRecordService {
  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async list(providerId: string, domain: string, filters: RecordListFilters = {}): Promise<RecordListResult> {
    const normalized = this.normalizeListFilters(filters)
    const { offset, limit, subdomain, record_type, keyword, refresh } = normalized

    const cacheKey = buildCacheKey(`${PROVIDER_TYPE}:records`, {
      provider_id: providerId,
      domain,
      offset,
      limit,
      subdomain,
      record_type,
      keyword,
    })

    if (!refresh) {
      const cached = globalCache.get<RecordListResult>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const payload: Record<string, unknown> = {
      Domain: domain,
      Offset: offset,
      Limit: limit,
      ErrorOnEmpty: 'no',
    }
    if (subdomain !== '') payload.Subdomain = subdomain
    if (record_type !== '') payload.RecordType = record_type
    if (keyword !== '') payload.Keyword = keyword

    let response: Record<string, unknown>
    try {
      response = await gateway.call<Record<string, unknown>>('DescribeRecordList', payload)
    } catch (error) {
      throw this.wrapError('dnspod_record_list_failed', 'DNSPod record list failed', providerId, error, {
        domain,
      })
    }

    const rawRecordList = Array.isArray(response.RecordList) ? response.RecordList : []
    const recordList = rawRecordList.map((record) => presentRecord(dnspodRecordSchema.parse(record)))
    const countInfo = response.RecordCountInfo as Record<string, unknown> | undefined

    const result: RecordListResult = {
      items: recordList,
      pagination: {
        offset,
        limit,
        count: Number(countInfo?.ListCount ?? 0),
        total: Number(countInfo?.TotalCount ?? 0),
      },
      request_id: response.RequestId as string | undefined,
      meta: offsetPaginationMeta({
        offset,
        limit,
        total: Number(countInfo?.TotalCount ?? 0),
      }),
    }

    globalCache.set(cacheKey, result, DEFAULT_TTL_MS, [
      providerCacheTag(providerId),
      recordCacheTag(PROVIDER_TYPE, providerId, domain),
    ])

    return result
  }

  async create(providerId: string, domain: string, input: RecordCreateInput): Promise<RecordMutationResult> {
    const payload = this.buildRecordPayload(domain, input)
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response: Record<string, unknown>
    try {
      response = await gateway.call<Record<string, unknown>>('CreateRecord', payload)
    } catch (error) {
      throw this.wrapError('dnspod_record_create_failed', 'DNSPod record create failed', providerId, error, {
        domain,
      })
    }

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    return {
      id: Number(response.RecordId ?? 0),
      request_id: response.RequestId as string | undefined,
    }
  }

  async update(
    providerId: string,
    domain: string,
    recordId: string,
    input: RecordCreateInput
  ): Promise<RecordMutationResult> {
    const payload = this.buildRecordPayload(domain, input)
    payload.RecordId = Number(recordId)

    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response: Record<string, unknown>
    try {
      response = await gateway.call<Record<string, unknown>>('ModifyRecord', payload)
    } catch (error) {
      throw this.wrapError('dnspod_record_update_failed', 'DNSPod record update failed', providerId, error, {
        domain,
      })
    }

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    return {
      id: Number(response.RecordId ?? 0),
      request_id: response.RequestId as string | undefined,
    }
  }

  async delete(providerId: string, domain: string, recordId: string): Promise<RecordMutationResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response: Record<string, unknown>
    try {
      response = await gateway.call<Record<string, unknown>>('DeleteRecord', {
        Domain: domain,
        RecordId: Number(recordId),
      })
    } catch (error) {
      throw this.wrapError('dnspod_record_delete_failed', 'DNSPod record delete failed', providerId, error, {
        domain,
      })
    }

    globalCache.invalidateTags([recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    return {
      id: Number(recordId),
      request_id: response.RequestId as string | undefined,
    }
  }

  private normalizeListFilters(filters: RecordListFilters) {
    return {
      offset: Math.max(0, filters.offset ?? 0),
      limit: Math.min(100, Math.max(1, filters.limit ?? 100)),
      subdomain: (filters.subdomain ?? '').trim(),
      record_type: (filters.record_type ?? '').trim().toUpperCase(),
      keyword: (filters.keyword ?? '').trim(),
      refresh: filters.refresh ?? false,
    }
  }

  private buildRecordPayload(domain: string, input: RecordCreateInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      Domain: domain,
      RecordType: input.record_type.trim().toUpperCase(),
      RecordLine: input.record_line,
      Value: input.value,
    }

    const optionalFields: Array<[keyof RecordCreateInput, string]> = [
      ['subdomain', 'SubDomain'],
      ['record_line_id', 'RecordLineId'],
      ['mx', 'MX'],
      ['ttl', 'TTL'],
      ['weight', 'Weight'],
      ['status', 'Status'],
      ['remark', 'Remark'],
    ]

    for (const [key, property] of optionalFields) {
      if (input[key] !== undefined) {
        payload[property] = input[key]
      }
    }

    return payload
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

function presentRecord(record: import('../../schemas/dnspod-responses.js').DnspodRecord): RecordListItem {
  return {
    id: record.RecordId ?? 0,
    name: record.Name ?? '',
    type: record.Type ?? '',
    value: record.Value ?? '',
    line: record.Line ?? '',
    line_id: record.LineId ?? '',
    status: record.Status ?? '',
    ttl: record.TTL ?? 0,
    mx: record.MX ?? 0,
    weight: record.Weight ?? 0,
    monitor_status: (record.MonitorStatus as string | undefined) ?? '',
    remark: record.Remark ?? '',
    default_ns: Boolean(record.DefaultNS ?? false),
    updated_on: record.UpdatedOn ?? '',
  }
}
