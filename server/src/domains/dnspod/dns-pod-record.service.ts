import type { ProviderRepository } from '../../kernel/providers/provider.repository.js'
import {
  buildCacheKey,
  providerCacheTag,
  recordCacheTag,
  withProviderCache,
} from '../../kernel/cache/provider-cache.js'
import { ApiError } from '../../kernel/http/api-error.js'
import { parseBool } from '../../lib/values.js'
import {
  callProvider,
  collectOffsetPages,
  parseUpstreamTotal,
  TENCENT_PAGE_SIZE,
  toFullListResult,
  type FullListPagination,
} from '../../kernel/providers/provider-call.js'
import { providerFiniteNumber, providerOptionalString, providerString } from '../../kernel/providers/provider-values.js'
import { invalidateDnsPodRecordCache } from './dns-pod.cache.js'
import { DnsPodClient, dnsPodClientFor } from './dns-pod.client.js'
import {
  dnspodMutationResponseSchema,
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
  dnspodRecordSchema,
  type DnsPodRecord,
} from './dns-pod-response.schema.js'

const PROVIDER_TYPE = 'dnspod'
export const DNSPOD_DEFAULT_LINE = '默认'

/** 下推到 DNSPod 的查询过滤 */
interface UpstreamFilter {
  subdomain?: string
  record_type?: string
}

interface RecordListFilters {
  refresh?: boolean
}

export interface DnsPodRecordItem {
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

interface RecordListResult {
  items: DnsPodRecordItem[]
  pagination: FullListPagination
  meta: FullListPagination
  request_id?: string
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

interface RecordMutationResult {
  id: number
  request_id?: string
}

// 本地字段 → DNSPod API 字段
const OPTIONAL_PAYLOAD_FIELDS: Array<[keyof RecordCreateInput, string]> = [
  ['subdomain', 'SubDomain'],
  ['record_line_id', 'RecordLineId'],
  ['mx', 'MX'],
  ['ttl', 'TTL'],
  ['weight', 'Weight'],
  ['status', 'Status'],
  ['remark', 'Remark'],
]

/** DNSPod 解析记录 CRUD；列表全量缓存，过滤在本地完成 */
export class DnsPodRecordService {
  constructor(private readonly providers: ProviderRepository) {}

  async list(providerId: string, domain: string, filters: RecordListFilters = {}): Promise<RecordListResult> {
    const cached = await withProviderCache<RecordListResult>({
      key: buildCacheKey(`${PROVIDER_TYPE}:records`, { provider_id: providerId, domain }),
      tags: [providerCacheTag(providerId), recordCacheTag(PROVIDER_TYPE, providerId, domain)],
      refresh: filters.refresh ?? false,
      loader: () => this.fetchAll(providerId, domain),
    })
    return cached.value
  }

  /**
   * 按 主机记录(+类型) 查询：过滤下推到 DNSPod，供同步/删除前的匹配使用。
   * 不走列表缓存（需要最新状态），也不写入缓存。
   */
  async query(providerId: string, domain: string, filter: UpstreamFilter): Promise<DnsPodRecordItem[]> {
    return (await this.fetchAll(providerId, domain, filter)).items
  }

  /** 精确匹配 主机记录 + 类型 + 线路（过滤下推上游，不经列表缓存） */
  async findExact(
    providerId: string,
    domain: string,
    input: RecordCreateInput | Record<string, unknown>
  ): Promise<DnsPodRecordItem[]> {
    const normalized = normalizeRecordInput(input)
    const subdomain = (normalized.subdomain || '@').toLowerCase()
    const items = await this.query(providerId, domain, { subdomain, record_type: normalized.record_type })
    const lineId = String(normalized.record_line_id || '').trim()
    return items.filter(
      (record) =>
        record.name.toLowerCase() === subdomain &&
        record.type.toUpperCase() === normalized.record_type &&
        (lineId ? record.line_id === lineId : record.line === normalized.record_line)
    )
  }

  async create(
    providerId: string,
    domain: string,
    input: RecordCreateInput | Record<string, unknown>
  ): Promise<RecordMutationResult> {
    const payload = buildRecordPayload(domain, normalizeRecordInput(input))
    return this.mutate(providerId, domain, 'CreateRecord', payload, 'dnspod_record_create_failed', 'create')
  }

  async update(
    providerId: string,
    domain: string,
    recordId: string,
    input: RecordCreateInput | Record<string, unknown>
  ): Promise<RecordMutationResult> {
    const payload = { ...buildRecordPayload(domain, normalizeRecordInput(input)), RecordId: requireRecordId(recordId) }
    return this.mutate(providerId, domain, 'ModifyRecord', payload, 'dnspod_record_update_failed', 'update')
  }

  async delete(providerId: string, domain: string, recordId: string): Promise<RecordMutationResult> {
    const id = requireRecordId(recordId)
    const client = await this.clientFor(providerId)
    const response = await callProvider(
      { code: 'dnspod_record_delete_failed', message: 'DNSPod record delete failed', providerId, details: { domain } },
      () => client.call('DeleteRecord', { Domain: domain, RecordId: id })
    )
    const parsed = dnspodMutationResponseSchema.parse(response)
    invalidateDnsPodRecordCache(providerId, domain)
    return { id, request_id: providerOptionalString(parsed.RequestId) }
  }

  private async mutate(
    providerId: string,
    domain: string,
    action: 'CreateRecord' | 'ModifyRecord',
    payload: Record<string, unknown>,
    code: string,
    verb: string
  ): Promise<RecordMutationResult> {
    const client = await this.clientFor(providerId)
    const response = await callProvider(
      { code, message: `DNSPod record ${verb} failed`, providerId, details: { domain } },
      () => client.call(action, payload)
    )
    const parsed = dnspodRecordMutationResponseSchema.parse(response)
    invalidateDnsPodRecordCache(providerId, domain)
    return { id: providerFiniteNumber(parsed.RecordId), request_id: providerOptionalString(parsed.RequestId) }
  }

  private async fetchAll(providerId: string, domain: string, filter: UpstreamFilter = {}): Promise<RecordListResult> {
    const client = await this.clientFor(providerId)
    const { items, requestId } = await collectOffsetPages(
      async (offset, limit) => {
        const response = await callProvider(
          { code: 'dnspod_record_list_failed', message: 'DNSPod record list failed', providerId, details: { domain } },
          () =>
            client.call('DescribeRecordList', {
              Domain: domain,
              Offset: offset,
              Limit: limit,
              ErrorOnEmpty: 'no',
              Subdomain: filter.subdomain || undefined,
              RecordType: filter.record_type || undefined,
            })
        )
        const parsed = dnspodRecordListResponseSchema.parse(response)
        return {
          items: (parsed.RecordList as unknown[]).map((record) => presentRecord(dnspodRecordSchema.parse(record))),
          sourceCount: Number(parsed.SourceCount ?? 0),
          total: parseUpstreamTotal(parsed.RecordCountInfo?.TotalCount),
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

  private clientFor(providerId: string): Promise<DnsPodClient> {
    return dnsPodClientFor(this.providers, providerId)
  }
}

/** 记录 ID 必须为正整数，避免 Number('abc') 产生 NaN 被发给上游 */
function requireRecordId(recordId: string): number {
  const id = Number(recordId)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError('validation_error', 'DNSPod record id must be a positive integer', 422)
  }
  return id
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

/** 解析非负整数；超出 [min, max] 视为非法（NaN/越界一律拒绝，避免上游 502） */
function optionalUint(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  const int = Math.floor(num)
  if (int < min || int > max) {
    throw new ApiError('validation_error', `Value out of range [${min}, ${max}]: ${value}`, 422)
  }
  return int
}

function normalizeRecordInput(raw: RecordCreateInput | Record<string, unknown>): RecordCreateInput {
  const input = (raw ?? {}) as Record<string, unknown>
  const recordType = String(input.record_type ?? '')
    .trim()
    .toUpperCase()
  const value = String(input.value ?? '').trim()
  if (!recordType || !value) {
    throw new ApiError('validation_error', 'record_type and value are required', 422)
  }

  const status = optionalString(input.status)
  const mx = optionalUint(input.mx, 0, 65535)
  return {
    record_type: recordType,
    record_line: optionalString(input.record_line) ?? DNSPOD_DEFAULT_LINE,
    value,
    subdomain: optionalString(input.subdomain),
    record_line_id: optionalString(input.record_line_id),
    status: status === 'ENABLE' || status === 'DISABLE' ? status : undefined,
    remark: optionalString(input.remark),
    // DNSPod 约束：TTL 1-604800，Weight 0-100，MX 0-65535
    ttl: optionalUint(input.ttl, 1, 604800),
    weight: optionalUint(input.weight, 0, 100),
    // MX 记录必须带优先级；其余类型仅在显式给出时传递
    mx: recordType === 'MX' ? (mx ?? 0) : mx,
  }
}

function buildRecordPayload(domain: string, input: RecordCreateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    Domain: domain,
    RecordType: input.record_type,
    RecordLine: input.record_line,
    Value: input.value,
  }
  for (const [key, property] of OPTIONAL_PAYLOAD_FIELDS) {
    const value = input[key]
    if (value !== undefined && value !== '') payload[property] = value
  }
  return payload
}

function presentRecord(record: DnsPodRecord): DnsPodRecordItem {
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
