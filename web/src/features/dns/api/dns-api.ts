import http, { POLL_TIMEOUT_MS, unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse } from '@/shared/api/types'
import type { DnsLine, DnsRecord, Zone } from '@/features/dns/model/types'
import { encodePath } from '@/shared/lib/path'

type DnsProviderType = 'dnspod' | 'cloudflare'
export type DnsProviderRef = { id: string; type: DnsProviderType; name?: string }

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
  data: Record<string, unknown>,
  options: Record<string, unknown> = {}
) {
  if (provider.type === 'cloudflare') {
    const zoneName = (options.zoneName as string) || zone
    const rawName = String(data.name || '').toLowerCase()
    const name =
      data.name === '@'
        ? zoneName
        : rawName.endsWith('.' + String(zoneName).toLowerCase())
          ? data.name
          : `${data.name}.${zoneName}`

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
  edgeone: 'EdgeOne',
}

function presentDomain(provider: DnsProviderRef, domain: Zone): Zone {
  const type = provider.type

  return {
    ...domain,
    provider: provider.id,
    provider_type: type,
    provider_name: provider.name || providerTypeNames[type] || type,
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
  zones: async (provider: DnsProviderRef, options: Record<string, unknown> = {}): Promise<ApiResponse<Zone[]>> => {
    const response = unwrapItems<Zone[]>(
      await http.get(endpoints.zones(provider), withRefresh({ refresh: options?.refresh }))
    )
    return { ...response, data: response.data.map((domain) => presentDomain(provider, domain)) }
  },
  createZone: (provider: DnsProviderRef, data: Record<string, unknown>): Promise<ApiResponse<Zone>> =>
    http.post(endpoints.zones(provider), provider.type === 'cloudflare' ? { name: data.domain ?? data.name } : data),
  deleteZone: (provider: DnsProviderRef, zone: string) => http.delete(endpoints.zone(provider, zone)),
  /** DNSPod 解析线路（Cloudflare 无线路概念，直接返回空） */
  lines: async (
    provider: DnsProviderRef,
    zone: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<{ items: DnsLine[]; groups: DnsLine[] }>> => {
    if (provider.type !== 'dnspod') return { code: 0, message: 'success', data: { items: [], groups: [] } }
    const response = await http.get(endpoints.lines(provider, zone), withRefresh({ refresh: options?.refresh }))
    const data = (response.data ?? {}) as { items?: DnsLine[]; groups?: DnsLine[] }
    return { ...response, data: { items: data.items ?? [], groups: data.groups ?? [] } }
  },
  records: async (
    provider: DnsProviderRef,
    domain: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<DnsRecord[]>> => {
    const response = unwrapItems<DnsRecord[]>(
      await http.get(endpoints.records(provider, domain), withRefresh({ refresh: options?.refresh }))
    )
    return { ...response, data: response.data.map((record) => presentRecord(provider, domain, record)) }
  },
  createRecord: (
    provider: DnsProviderRef,
    domain: string,
    data: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<ApiResponse<DnsRecord>> =>
    http.post(endpoints.records(provider, domain), recordPayload(provider, domain, data, options || {})),
  updateRecord: (
    provider: DnsProviderRef,
    domain: string,
    recordId: string,
    data: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<ApiResponse<DnsRecord>> =>
    http.put(endpoints.record(provider, domain, recordId), recordPayload(provider, domain, data, options || {})),
  deleteRecord: (provider: DnsProviderRef, domain: string, recordId: string) =>
    http.delete(endpoints.record(provider, domain, recordId)),
  batchCreateRecords: (provider: DnsProviderRef, domain: string, data: { records: Array<Record<string, unknown>> }) =>
    http.post(endpoints.recordsBatchCreate(provider, domain), data),
  batchDeleteRecords: (
    provider: DnsProviderRef,
    domain: string,
    data: { records: Array<{ id: string; name?: string; type?: string }> }
  ) => http.post(endpoints.recordsBatchDelete(provider, domain), data),
  batchUpdateRecords: (
    provider: DnsProviderRef,
    domain: string,
    data: { records: Array<Record<string, unknown>>; patch: Record<string, unknown> }
  ) => http.post(endpoints.recordsBatchUpdate(provider, domain), data),
  batchJob: (provider: DnsProviderRef, jobId: string) =>
    http.get(endpoints.recordsBatchJob(provider, jobId), { timeout: POLL_TIMEOUT_MS }),
  batchRetry: (provider: DnsProviderRef, jobId: string) => http.post(endpoints.recordsBatchRetry(provider, jobId)),
  batchActive: (provider: DnsProviderRef, domain: string) =>
    http.get(endpoints.recordsBatchActive(provider, domain), { timeout: POLL_TIMEOUT_MS }),
}
