import { ProviderRepository } from '../../provider/repository.js'
import { CacheTtl, buildCacheKey, invalidateProviderCache, offsetPaginationMeta, providerCacheTag, recordCacheTag, withProviderCache } from '../../../lib/cache/provider-cache.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { DnsPodGateway } from '../gateways/gateway.js'
import {
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
  dnspodRecordSchema,
} from '../../../lib/providers/dnspod-response.js'
import type { DnsPodProvider } from '../../provider/types.js'

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

    const cached = await withProviderCache<RecordListResult>({
      key: buildCacheKey(`${PROVIDER_TYPE}:records`, {
      provider_id: providerId,
      domain,
      offset,
      limit,
      subdomain,
      record_type,
      keyword,
    }),
      tags: [
      providerCacheTag(providerId),
      recordCacheTag(PROVIDER_TYPE, providerId, domain),
    ],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
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

        let response: unknown
        try {
          response = await gateway.call('DescribeRecordList', payload)
        } catch (error) {
          throw this.wrapError('dnspod_record_list_failed', 'DNSPod record list failed', providerId, error, {
            domain,
          })
        }

        const parsed = dnspodRecordListResponseSchema.parse(response)
        const rawRecordList = Array.isArray(parsed.RecordList) ? parsed.RecordList : []
        const recordList = rawRecordList.map((record) => presentRecord(dnspodRecordSchema.parse(record)))
        const countInfo = parsed.RecordCountInfo

        const result: RecordListResult = {
          items: recordList,
          pagination: {
            offset,
            limit,
            count: Number(countInfo?.ListCount ?? 0),
            total: Number(countInfo?.TotalCount ?? 0),
          },
          request_id: parsed.RequestId ?? undefined,
          meta: offsetPaginationMeta({
            offset,
            limit,
            total: Number(countInfo?.TotalCount ?? 0),
          }),
        }
        return result
      },
    })

    return cached.value
  }

  async create(providerId: string, domain: string, input: RecordCreateInput): Promise<RecordMutationResult> {
    const payload = this.buildRecordPayload(domain, this.normalizeRecordInput(input))
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response: unknown
    try {
      response = await gateway.call('CreateRecord', payload)
    } catch (error) {
      throw this.wrapError('dnspod_record_create_failed', 'DNSPod record create failed', providerId, error, {
        domain,
      })
    }

    invalidateProviderCache([recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    const parsed = dnspodRecordMutationResponseSchema.parse(response)
    return {
      id: parsed.RecordId ?? 0,
      request_id: parsed.RequestId ?? undefined,
    }
  }

  async update(
    providerId: string,
    domain: string,
    recordId: string,
    input: RecordCreateInput
  ): Promise<RecordMutationResult> {
    const payload = this.buildRecordPayload(domain, this.normalizeRecordInput(input))
    payload.RecordId = Number(recordId)

    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response: unknown
    try {
      response = await gateway.call('ModifyRecord', payload)
    } catch (error) {
      throw this.wrapError('dnspod_record_update_failed', 'DNSPod record update failed', providerId, error, {
        domain,
      })
    }

    invalidateProviderCache([recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    const parsed = dnspodRecordMutationResponseSchema.parse(response)
    return {
      id: parsed.RecordId ?? 0,
      request_id: parsed.RequestId ?? undefined,
    }
  }

  async delete(providerId: string, domain: string, recordId: string): Promise<RecordMutationResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = new DnsPodGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response: unknown
    try {
      response = await gateway.call('DeleteRecord', {
        Domain: domain,
        RecordId: Number(recordId),
      })
    } catch (error) {
      throw this.wrapError('dnspod_record_delete_failed', 'DNSPod record delete failed', providerId, error, {
        domain,
      })
    }

    invalidateProviderCache([recordCacheTag(PROVIDER_TYPE, providerId, domain)])

    const parsed = dnspodRecordMutationResponseSchema.parse(response)
    return {
      id: Number(recordId),
      request_id: parsed.RequestId ?? undefined,
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

  private normalizeRecordInput(raw: RecordCreateInput | Record<string, unknown>): RecordCreateInput {
    const input = (raw ?? {}) as Record<string, unknown>
    const recordType = String(input.record_type ?? '').trim().toUpperCase()
    const recordLine = String(input.record_line ?? '').trim() || '默认'
    const value = String(input.value ?? '').trim()
    if (!recordType || !value) {
      throw new ApiError('validation_error', 'record_type and value are required', 422)
    }

    const normalized: RecordCreateInput = {
      record_type: recordType,
      record_line: recordLine,
      value,
    }

    const subdomain = this.optionalString(input.subdomain)
    if (subdomain !== undefined) normalized.subdomain = subdomain

    const recordLineId = this.optionalString(input.record_line_id)
    if (recordLineId !== undefined) normalized.record_line_id = recordLineId

    const status = this.optionalString(input.status)
    if (status === 'ENABLE' || status === 'DISABLE') normalized.status = status

    const remark = this.optionalString(input.remark)
    if (remark !== undefined) normalized.remark = remark

    const ttl = this.optionalUint(input.ttl)
    if (ttl !== undefined) normalized.ttl = ttl

    const weight = this.optionalUint(input.weight)
    if (weight !== undefined) normalized.weight = weight

    // DNSPod: MX must be uint64 when present. Empty string from frontend must be omitted.
    // Only send MX for MX records (or when a valid number is explicitly provided).
    const mx = this.optionalUint(input.mx)
    if (recordType === 'MX') {
      normalized.mx = mx ?? 0
    } else if (mx !== undefined) {
      normalized.mx = mx
    }

    return normalized
  }

  private optionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    const text = String(value).trim()
    return text === '' ? undefined : text
  }

  private optionalUint(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const num = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(num) || num < 0) return undefined
    return Math.floor(num)
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
      const value = input[key]
      // Skip undefined/null/empty-string so DNSPod does not receive invalid typed params.
      if (value === undefined || value === null || value === '') continue
      payload[property] = value
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

function presentRecord(record: import('../../../lib/providers/dnspod-response.js').DnspodRecord): RecordListItem {
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
    monitor_status: record.MonitorStatus ?? '',
    remark: record.Remark ?? '',
    default_ns: Boolean(record.DefaultNS ?? false),
    updated_on: record.UpdatedOn ?? '',
  }
}
