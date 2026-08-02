import { ProviderRepository } from '../providers/provider.repository.js'
import {
  buildCacheKey,
  offsetPaginationMeta,
  providerCacheTag,
  recordCacheTag,
  withProviderCache,
} from '../../platform/cache/provider-cache.js'
import { invalidateDnsPodRecordCache } from './dns-pod.cache.js'
import { ApiError } from '../../shared/http/api-error.js'
import { wrapProviderError } from '../../shared/http/wrap-provider-error.js'
import { parseBool } from '../../shared/lib/parse-bool.js'
import { providerFiniteNumber, providerOptionalString, providerString } from '../../shared/providers/provider-values.js'
import { DnsPodGateway } from './dns-pod.client.js'
import {
  dnspodMutationResponseSchema,
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
  dnspodRecordSchema,
} from './dns-pod-response.schema.js'
import type { DnsPodProvider } from '../providers/provider.types.js'

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
  constructor(private readonly providers: ProviderRepository) {}

  async list(providerId: string, domain: string, filters: RecordListFilters = {}): Promise<RecordListResult> {
    const normalized = this.normalizeListFilters(filters)
    const { subdomain, record_type, keyword, refresh } = normalized
    const cached = await withProviderCache<RecordListResult>({
      key: buildCacheKey(`${PROVIDER_TYPE}:records`, { provider_id: providerId, domain }),
      tags: [providerCacheTag(providerId), recordCacheTag(PROVIDER_TYPE, providerId, domain)],
      refresh,
      loader: async () => {
        const provider = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)
        const pageSize = 100
        const items: RecordListItem[] = []
        let offset = 0
        let pages = 0
        let requestId: string | undefined

        while (true) {
          let response: unknown
          try {
            response = await gateway.call('DescribeRecordList', {
              Domain: domain,
              Offset: offset,
              Limit: pageSize,
              ErrorOnEmpty: 'no',
            })
          } catch (error) {
            throw wrapProviderError('dnspod_record_list_failed', 'DNSPod record list failed', providerId, error, {
              domain,
            })
          }
          const parsed = dnspodRecordListResponseSchema.parse(response)
          pages++
          const sourceCount = Number(parsed.SourceCount ?? 0)
          const pageItems = (Array.isArray(parsed.RecordList) ? parsed.RecordList : []).map((record) =>
            presentRecord(dnspodRecordSchema.parse(record))
          )
          items.push(...pageItems)
          const totalRaw = parsed.RecordCountInfo?.TotalCount
          const totalValue = Number(totalRaw)
          const total =
            totalRaw != null && totalRaw !== '' && Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : null
          requestId = parsed.RequestId ?? requestId
          offset += sourceCount
          if (sourceCount < pageSize || (total !== null && offset >= total)) break
          if (pages >= 1000) throw new ApiError('dnspod_pagination_limit', 'DNSPod pagination limit reached', 502)
        }

        return {
          items,
          pagination: { offset: 0, limit: items.length, count: items.length, total: items.length },
          request_id: requestId,
          meta: offsetPaginationMeta({ offset: 0, limit: items.length || 1, total: items.length }),
        }
      },
    })

    const search = keyword.toLowerCase()
    const items = cached.value.items.filter((record) => {
      if (subdomain && !record.name.toLowerCase().includes(subdomain.toLowerCase())) return false
      if (record_type && record.type.toUpperCase() !== record_type) return false
      if (!search) return true
      return [record.name, record.type, record.value, record.line, record.remark].some((value) =>
        String(value).toLowerCase().includes(search)
      )
    })
    return {
      ...cached.value,
      items,
      pagination: { offset: 0, limit: items.length, count: items.length, total: items.length },
      meta: offsetPaginationMeta({ offset: 0, limit: items.length || 1, total: items.length }),
    }
  }

  async findExact(
    providerId: string,
    domain: string,
    input: RecordCreateInput | Record<string, unknown>,
    refresh = false
  ): Promise<RecordListItem[]> {
    const normalized = this.normalizeRecordInput(input)
    const result = await this.list(providerId, domain, {
      subdomain: normalized.subdomain || '@',
      record_type: normalized.record_type,
      refresh,
    })
    const expectedLineId = String(normalized.record_line_id || '').trim()
    const line = normalized.record_line || '默认'
    return result.items.filter(
      (record) =>
        record.name.toLowerCase() === (normalized.subdomain || '@').toLowerCase() &&
        record.type.toUpperCase() === normalized.record_type.toUpperCase() &&
        (expectedLineId ? String(record.line_id || '') === expectedLineId : record.line === line)
    )
  }

  async create(
    providerId: string,
    domain: string,
    input: RecordCreateInput | Record<string, unknown>
  ): Promise<RecordMutationResult> {
    const payload = this.buildRecordPayload(domain, this.normalizeRecordInput(input))
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response: unknown
    try {
      response = await gateway.call('CreateRecord', payload)
    } catch (error) {
      throw wrapProviderError('dnspod_record_create_failed', 'DNSPod record create failed', providerId, error, {
        domain,
      })
    }

    const parsed = dnspodRecordMutationResponseSchema.parse(response)
    const result = {
      id: providerFiniteNumber(parsed.RecordId),
      request_id: providerOptionalString(parsed.RequestId),
    }
    await invalidateDnsPodRecordCache(providerId, domain)
    return result
  }

  async update(
    providerId: string,
    domain: string,
    recordId: string,
    input: RecordCreateInput | Record<string, unknown>
  ): Promise<RecordMutationResult> {
    const payload = this.buildRecordPayload(domain, this.normalizeRecordInput(input))
    payload.RecordId = Number(recordId)

    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response: unknown
    try {
      response = await gateway.call('ModifyRecord', payload)
    } catch (error) {
      throw wrapProviderError('dnspod_record_update_failed', 'DNSPod record update failed', providerId, error, {
        domain,
      })
    }

    const parsed = dnspodRecordMutationResponseSchema.parse(response)
    const result = {
      id: providerFiniteNumber(parsed.RecordId),
      request_id: providerOptionalString(parsed.RequestId),
    }
    await invalidateDnsPodRecordCache(providerId, domain)
    return result
  }

  async delete(providerId: string, domain: string, recordId: string): Promise<RecordMutationResult> {
    const provider = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response: unknown
    try {
      response = await gateway.call('DeleteRecord', {
        Domain: domain,
        RecordId: Number(recordId),
      })
    } catch (error) {
      throw wrapProviderError('dnspod_record_delete_failed', 'DNSPod record delete failed', providerId, error, {
        domain,
      })
    }

    const parsed = dnspodMutationResponseSchema.parse(response)
    const result = {
      id: providerFiniteNumber(recordId),
      request_id: providerOptionalString(parsed.RequestId),
    }
    await invalidateDnsPodRecordCache(providerId, domain)
    return result
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
    const recordType = String(input.record_type ?? '')
      .trim()
      .toUpperCase()
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

  private gatewayFor(provider: DnsPodProvider): DnsPodGateway {
    return DnsPodGateway.forCredentials({
      secretId: provider.secret_id,
      secretKey: provider.secret_key,
    })
  }
}

function presentRecord(record: import('./dns-pod-response.schema.js').DnsPodRecord): RecordListItem {
  return {
    id: providerFiniteNumber(record.RecordId),
    name: providerString(record.Name),
    type: providerString(record.Type),
    value: providerString(record.Value),
    line: providerString(record.Line),
    line_id: providerString(record.LineId),
    status: providerString(record.Status),
    ttl: providerFiniteNumber(record.TTL),
    mx: providerFiniteNumber(record.MX),
    weight: providerFiniteNumber(record.Weight),
    monitor_status: providerString(record.MonitorStatus),
    remark: providerString(record.Remark),
    default_ns: parseBool(record.DefaultNS ?? false),
    updated_on: providerString(record.UpdatedOn),
  }
}
