import http, { POLL_TIMEOUT_MS, unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse } from '@/shared/api/types'
import type { JobLike } from '@/shared/job'
import type { DnsLine, DnsRecord, Zone } from '@/features/dns/model/types'
import { encodePath } from '@/shared/lib/path'

type DnsProviderType = 'dnspod' | 'cloudflare' | 'saas'
export type DnsProviderRef = { id: string; type: DnsProviderType; name?: string }

/** 记录写载荷：DNSPod 与 Cloudflare 字段并集，由 recordPayload 归一成各上游格式 */
type DnsRecordWriteInput = {
  name?: string
  type?: string
  value?: string
  content?: string
  ttl?: number | string
  line?: string
  record_line?: string
  record_line_id?: string
  status?: string
  weight?: number | string
  remark?: string
  comment?: string
  priority?: number | string
  mx?: number | string
  proxied?: boolean
  subdomain?: string
  record_type?: string
}

/** 批量修改 patch：只承载用户明确要改的字段 */
export type DnsRecordBatchPatch = {
  value?: string
  ttl?: number
  line?: string
  record_line_id?: string
  remark?: string
  priority?: number
  proxied?: boolean
}

/** 域名创建载荷：DNSPod 用 domain，Cloudflare 用 name */
type DnsZoneWriteInput = { domain?: string; name?: string }

/** 写接口选项：Cloudflare 需要 zoneName 把主机记录补成全限定名 */
type DnsWriteOptions = { zoneName?: string }

/** 读接口选项：signal 由 useResourceQuery 的 queryFn 注入，用于中止卸载/切换作用域后的在飞请求 */
type DnsReadOptions = { refresh?: boolean; signal?: AbortSignal }

const providerBase = (provider: DnsProviderRef) => `/${provider.type}/providers/${encodePath(provider.id)}`
const zoneBase = (provider: DnsProviderRef, zone: string) => `${providerBase(provider)}/zones/${encodePath(zone)}`
const endpoints = {
  zones: (provider: DnsProviderRef) => `${providerBase(provider)}/zones`,
  zone: (provider: DnsProviderRef, zone: string) => zoneBase(provider, zone),
  records: (provider: DnsProviderRef, zone: string) => `${zoneBase(provider, zone)}/records`,
  lines: (provider: DnsProviderRef, zone: string) => `${zoneBase(provider, zone)}/lines`,
  record: (provider: DnsProviderRef, zone: string, record: string) =>
    `${zoneBase(provider, zone)}/records/${encodePath(record)}`,
  recordsBatchCreate: (provider: DnsProviderRef, zone: string) => `${zoneBase(provider, zone)}/records/batch-create`,
  recordsBatchDelete: (provider: DnsProviderRef, zone: string) => `${zoneBase(provider, zone)}/records/batch-delete`,
  recordsBatchUpdate: (provider: DnsProviderRef, zone: string) => `${zoneBase(provider, zone)}/records/batch-update`,
  recordsBatchActive: (provider: DnsProviderRef, zone: string) => `${zoneBase(provider, zone)}/records/batch/active`,
  recordsBatchJob: (provider: DnsProviderRef, jobId: string) =>
    `${providerBase(provider)}/records/batch/${encodePath(jobId)}`,
  recordsBatchRetry: (provider: DnsProviderRef, jobId: string) =>
    `${providerBase(provider)}/records/batch/${encodePath(jobId)}/retry`,
}

function recordPayload(
  provider: DnsProviderRef,
  zone: string,
  data: DnsRecordWriteInput,
  options: DnsWriteOptions = {}
) {
  if (provider.type === 'cloudflare') {
    const zoneName = options.zoneName || zone
    const rawName = String(data.name || '').toLowerCase()
    // 主机名缺省按 @ 处理：直接用 data.name 拼接会产出 `undefined.example.com`
    const name =
      rawName === '' || rawName === '@'
        ? zoneName
        : rawName.endsWith('.' + String(zoneName).toLowerCase())
          ? rawName
          : `${rawName}.${zoneName}`

    return {
      type: data.type,
      name,
      content: data.value ?? data.content,
      ttl: data.ttl || 1,
      priority: data.priority ?? data.mx,
      comment: data.remark,
      proxied: data.proxied,
    }
  }

  return {
    record_type: data.type ?? data.record_type,
    record_line: data.line ?? data.record_line ?? '默认',
    value: data.value,
    subdomain: data.name ?? data.subdomain ?? '@',
    ttl: data.ttl,
    mx: data.priority ?? data.mx,
    weight: data.weight,
    record_line_id: data.record_line_id,
    status: data.status ? String(data.status).toUpperCase() : undefined,
    remark: data.remark,
  }
}

const providerTypeNames: Record<string, string> = {
  cloudflare: 'Cloudflare',
  dnspod: 'DNSPod',
  saas: 'Cloudflare SaaS',
}

/** 服务商类型展示名：跨 feature 引用 providers 的同名映射违反分层约束（ARCH005），这里各自维护 */
export function dnsProviderTypeLabel(type: DnsProviderType): string {
  return providerTypeNames[type] || type
}

function presentDomain(provider: DnsProviderRef, domain: Zone): Zone {
  const type = provider.type

  return {
    ...domain,
    provider: provider.id,
    provider_type: type,
    provider_name: provider.name || dnsProviderTypeLabel(type),
    name_servers: domain.name_servers || domain.effective_dns || [],
    access_status: domain.access_status || domain.status || domain.dns_status,
  }
}

function presentRecord(provider: DnsProviderRef, domain: string, record: DnsRecord): DnsRecord {
  if (provider.type === 'cloudflare') {
    const fqdn = String(record.name || '')
    const zoneName = String(record.zone_name || domain || '')
    const host =
      zoneName && fqdn.toLowerCase() === zoneName.toLowerCase()
        ? '@'
        : zoneName && fqdn.toLowerCase().endsWith('.' + zoneName.toLowerCase())
          ? fqdn.slice(0, -(zoneName.length + 1))
          : fqdn

    return {
      ...record,
      provider: provider.id,
      provider_type: 'cloudflare',
      fqdn,
      name: host,
      value: record.content,
      line: '默认',
      remark: record.comment || '',
      priority: record.priority,
    }
  }
  return {
    ...record,
    provider: provider.id,
    provider_type: 'dnspod',
    priority: record.mx,
    record_line_id: record.record_line_id ?? record.line_id,
    remark: record.remark || '',
  }
}

export const dnsApi = {
  zones: async (provider: DnsProviderRef, options: DnsReadOptions = {}): Promise<ApiResponse<Zone[]>> => {
    const response = unwrapItems<Zone[]>(
      await http.get(endpoints.zones(provider), {
        ...withRefresh({ refresh: options.refresh }),
        signal: options.signal,
      })
    )
    return { ...response, data: response.data.map((domain) => presentDomain(provider, domain)) }
  },
  createZone: (provider: DnsProviderRef, data: DnsZoneWriteInput): Promise<ApiResponse<Zone>> =>
    http.post(endpoints.zones(provider), provider.type === 'cloudflare' ? { name: data.domain ?? data.name } : data),
  deleteZone: (provider: DnsProviderRef, zone: string) => http.delete(endpoints.zone(provider, zone)),
  /** DNSPod 解析线路（Cloudflare 无线路概念，直接返回空） */
  lines: async (
    provider: DnsProviderRef,
    zone: string,
    options: DnsReadOptions = {}
  ): Promise<ApiResponse<{ items: DnsLine[]; groups: DnsLine[] }>> => {
    if (provider.type !== 'dnspod') return { code: 0, message: 'success', data: { items: [], groups: [] } }
    const response = await http.get(endpoints.lines(provider, zone), {
      ...withRefresh({ refresh: options.refresh }),
      signal: options.signal,
    })
    const data = (response.data ?? {}) as { items?: DnsLine[]; groups?: DnsLine[] }
    return { ...response, data: { items: data.items ?? [], groups: data.groups ?? [] } }
  },
  records: async (
    provider: DnsProviderRef,
    domain: string,
    options: DnsReadOptions = {}
  ): Promise<ApiResponse<DnsRecord[]>> => {
    const response = unwrapItems<DnsRecord[]>(
      await http.get(endpoints.records(provider, domain), {
        ...withRefresh({ refresh: options.refresh }),
        signal: options.signal,
      })
    )
    return { ...response, data: response.data.map((record) => presentRecord(provider, domain, record)) }
  },
  createRecord: (
    provider: DnsProviderRef,
    domain: string,
    data: DnsRecordWriteInput,
    options?: DnsWriteOptions
  ): Promise<ApiResponse<DnsRecord>> =>
    http.post(endpoints.records(provider, domain), recordPayload(provider, domain, data, options || {})),
  updateRecord: (
    provider: DnsProviderRef,
    domain: string,
    recordId: string,
    data: DnsRecordWriteInput,
    options?: DnsWriteOptions
  ): Promise<ApiResponse<DnsRecord>> =>
    http.put(endpoints.record(provider, domain, recordId), recordPayload(provider, domain, data, options || {})),
  deleteRecord: (provider: DnsProviderRef, domain: string, recordId: string) =>
    http.delete(endpoints.record(provider, domain, recordId)),
  batchCreateRecords: (provider: DnsProviderRef, domain: string, data: { records: DnsRecordWriteInput[] }) =>
    http.post(endpoints.recordsBatchCreate(provider, domain), data),
  batchDeleteRecords: (
    provider: DnsProviderRef,
    domain: string,
    data: { records: Array<{ id: string; name?: string; type?: string }> }
  ) => http.post(endpoints.recordsBatchDelete(provider, domain), data),
  batchUpdateRecords: (
    provider: DnsProviderRef,
    domain: string,
    data: { records: DnsRecordWriteInput[]; patch: DnsRecordBatchPatch }
  ) => http.post(endpoints.recordsBatchUpdate(provider, domain), data),
  batchJob: (provider: DnsProviderRef, jobId: string) =>
    http.get(endpoints.recordsBatchJob(provider, jobId), { timeout: POLL_TIMEOUT_MS }),
  batchRetry: (provider: DnsProviderRef, jobId: string) => http.post(endpoints.recordsBatchRetry(provider, jobId)),
  batchActive: (provider: DnsProviderRef, domain: string) =>
    http.get(endpoints.recordsBatchActive(provider, domain), { timeout: POLL_TIMEOUT_MS }),
}

/** 批量任务轮询适配：runBatchJob / PollJobOptions 要裸任务对象，接口返回的是 ApiResponse 包装 */
export function batchJobFetcher(provider: DnsProviderRef): (jobId: string) => Promise<JobLike> {
  return async (jobId) => ((await dnsApi.batchJob(provider, jobId)).data as JobLike) || {}
}

/** 批量任务重试适配：把 provider 固定进任务创建时返回的 retry 回调 */
export function batchJobRetrier(provider: DnsProviderRef) {
  return (jobId: string) => dnsApi.batchRetry(provider, jobId)
}
