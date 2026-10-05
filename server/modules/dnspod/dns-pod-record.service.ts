import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import { buildCacheKey, providerCacheTag, recordCacheTag, withProviderCache } from '../../core/cache/provider-cache.js'
import { ApiError } from '../../core/http/api-error.js'
import { parseBool } from '../../shared/values.js'
import {
  callProvider,
  collectOffsetPages,
  TENCENT_PAGE_SIZE,
  toFullListResult,
} from '../../core/providers/provider-call.js'
import { providerFiniteNumber, providerOptionalString, providerString } from '../../core/providers/provider-values.js'
import { DNSPOD_PROVIDER_TYPE, invalidateDnsPodRecordCache } from './dns-pod.cache.js'
import { DnsPodClient, dnsPodClientFor } from './dns-pod.client.js'
import {
  dnspodMutationResponseSchema,
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
  dnspodRecordSchema,
  type DnsPodRecord,
} from './dns-pod-response.schema.js'

export const DNSPOD_DEFAULT_LINE = '默认'

/** 下推到 DNSPod 的查询过滤 */
interface UpstreamFilter {
  subdomain?: string
  record_type?: string
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

/** 与 core 的 toFullListResult 保持同一形状，避免各服务重复声明分页元数据 */
type RecordListResult = ReturnType<typeof toFullListResult<DnsPodRecordItem>>

export interface RecordCreateInput {
  record_type: string
  /** 省略时按默认线路写入 */
  record_line?: string
  value: string
  subdomain?: string
  record_line_id?: string
  mx?: number
  ttl?: number
  weight?: number
  status?: 'ENABLE' | 'DISABLE'
  remark?: string
}

/** 归一化后的写入输入：线路已回填默认值 */
type NormalizedRecordInput = RecordCreateInput & { record_line: string }

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
  constructor(
    private readonly providers: ProviderRepository,
    private readonly httpTimeoutMs?: number
  ) {}

  async list(providerId: string, domain: string, options: { refresh?: boolean } = {}): Promise<RecordListResult> {
    const normalized = normalizeDomain(domain)
    const cached = await withProviderCache<RecordListResult>({
      key: buildCacheKey(`${DNSPOD_PROVIDER_TYPE}:records`, { provider_id: providerId, domain: normalized }),
      tags: [providerCacheTag(providerId), recordCacheTag(DNSPOD_PROVIDER_TYPE, providerId, normalized)],
      refresh: options.refresh ?? false,
      loader: () => this.fetchAll(providerId, normalized),
    })
    return cached.value
  }

  /**
   * 按 主机记录(+类型) 查询：过滤下推到 DNSPod，供同步/删除前的匹配使用。
   * 不走列表缓存（需要最新状态），也不写入缓存。
   */
  async query(providerId: string, domain: string, filter: UpstreamFilter): Promise<DnsPodRecordItem[]> {
    return (await this.fetchAll(providerId, normalizeDomain(domain), filter)).items
  }

  async create(providerId: string, domain: string, input: RecordCreateInput): Promise<RecordMutationResult> {
    const normalized = normalizeDomain(domain)
    const payload = buildRecordPayload(normalized, normalizeRecordInput(input))
    return this.mutate(providerId, normalized, 'CreateRecord', payload, 'dnspod_record_create_failed', 'create')
  }

  async update(
    providerId: string,
    domain: string,
    recordId: string,
    input: RecordCreateInput
  ): Promise<RecordMutationResult> {
    const normalized = normalizeDomain(domain)
    const payload = {
      ...buildRecordPayload(normalized, normalizeRecordInput(input)),
      RecordId: requireRecordId(recordId),
    }
    return this.mutate(providerId, normalized, 'ModifyRecord', payload, 'dnspod_record_update_failed', 'update')
  }

  async delete(providerId: string, domain: string, recordId: string): Promise<RecordMutationResult> {
    const normalized = normalizeDomain(domain)
    const id = requireRecordId(recordId)
    const client = await this.clientFor(providerId)
    const response = await callProvider(
      {
        code: 'dnspod_record_delete_failed',
        message: 'DNSPod record delete failed',
        providerId,
        details: { domain: normalized },
      },
      () => client.call('DeleteRecord', { Domain: normalized, RecordId: id })
    )
    const parsed = dnspodMutationResponseSchema.parse(response)
    invalidateDnsPodRecordCache(providerId, normalized)
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
    return dnsPodClientFor(this.providers, providerId, this.httpTimeoutMs)
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

/** 解析非负整数；非有限数静默忽略，越界抛 422（避免把非法值发给上游） */
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

/** DNSPod 域名大小写不敏感：统一小写去空白，保证缓存键与失效标签一致 */
function normalizeDomain(domain: string): string {
  return domain.toLowerCase().trim()
}

function normalizeRecordInput(raw: RecordCreateInput): NormalizedRecordInput {
  // 输入可能来自 schema 之外的路径（探针/旧数据），字段逐个读取后再归一
  const input: Partial<RecordCreateInput> = raw ?? {}
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

function buildRecordPayload(domain: string, input: NormalizedRecordInput): Record<string, unknown> {
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
