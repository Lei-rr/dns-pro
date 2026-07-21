import http, { unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse, EdgeOneAccelerationDomain, EdgeOneZone } from '@/shared/types'

const path = (value: string) => encodeURIComponent(value)
const providerBase = (provider: string) => `/edgeone/providers/${path(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${path(zone)}`
const domainBase = (provider: string, zone: string, domain: string) =>
  `${zoneBase(provider, zone)}/records/${path(domain)}`

function edgeOneQuery(options: Record<string, unknown> = {}, defaultPerPage = 20) {
  const page = Math.max(1, Number(options.page) || 1)
  const perPage = Math.max(1, Number(options.per_page) || defaultPerPage)
  return {
    offset: (page - 1) * perPage,
    limit: perPage,
  }
}

export const edgeOneApi = {
  zones: async (provider: string, options: Record<string, unknown> = {}): Promise<ApiResponse<EdgeOneZone[]>> =>
    unwrapItems<EdgeOneZone[]>(
      await http.get(`${providerBase(provider)}/zones`, withRefresh({ params: edgeOneQuery(options, 20), refresh: options?.refresh })),
    ),
  zone: (provider: string, zoneId: string): Promise<ApiResponse<EdgeOneZone>> =>
    http.get(`${providerBase(provider)}/zones/${path(zoneId)}`),
  accelerationDomains: async (
    provider: string,
    zone: string,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<EdgeOneAccelerationDomain[]>> =>
    unwrapItems<EdgeOneAccelerationDomain[]>(
      await http.get(
        `${zoneBase(provider, zone)}/records`,
        withRefresh({ params: edgeOneQuery(options, 20), refresh: options?.refresh }),
      ),
    ),
  createAccelerationDomain: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {},
  ) =>
    http.post(
      `${zoneBase(provider, zone)}/records`,
      data,
      options.autoSync ? { params: { auto_sync: 1 } } : {},
    ),
  updateAccelerationDomain: (provider: string, zone: string, domain: string, data: Record<string, unknown>) =>
    http.put(domainBase(provider, zone, domain), data),
  updateAccelerationDomainStatus: (provider: string, zone: string, domain: string, status: string) =>
    http.put(`${domainBase(provider, zone, domain)}/status`, { status }),
  updateCertificate: (provider: string, zone: string, domain: string, data: Record<string, unknown>) =>
    http.put(`${domainBase(provider, zone, domain)}/certificate`, data),
  deleteAccelerationDomain: (
    provider: string,
    zone: string,
    domain: string,
    options: Record<string, unknown> = {},
  ) =>
    http.delete(
      domainBase(provider, zone, domain),
      options.skipCleanup ? { params: { auto_cleanup: 0 } } : {},
    ),
  syncAccelerationDomainCname: (provider: string, zone: string, domain: string) =>
    http.post(`${domainBase(provider, zone, domain)}/cname-sync`),
  batchDisable: (provider: string, zone: string, data: { domains: string[] }) =>
    http.post(`${zoneBase(provider, zone)}/batch/disable`, data),
  batchDelete: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/batch/delete`, data),
  batchActive: (provider: string, zone: string) => http.get(`${zoneBase(provider, zone)}/batch/active`),
  batchJob: (provider: string, jobId: string) => http.get(`${providerBase(provider)}/batch/${path(jobId)}`),
  batchRetry: (provider: string, jobId: string) => http.post(`${providerBase(provider)}/batch/${path(jobId)}/retry`),
}

export function edgeOneStatusLabel(status?: string) {
  const key = String(status || '').toLowerCase()
  return (
    {
      online: '已生效',
      process: '部署中',
      offline: '已停用',
      forbidden: '已封禁',
      init: '未生效',
      active: '已生效',
      pending: '配置中',
    }[key] || status || '-'
  )
}

/** EdgeOne zone.Type is access mode, not an ID. */
export function edgeOneAccessLabel(type?: string) {
  const key = String(type || '')
  const map: Record<string, string> = {
    dnsPodAccess: 'DNSPod 接入',
    partial: 'CNAME 接入',
    full: '全量接入',
    noDomainAccess: '无域名接入',
    pages: 'Pages',
    ai: 'AI',
  }
  return map[key] || map[key.toLowerCase()] || key || '-'
}

export function certificateStatusLabel(status?: string) {
  const key = String(status || '').toLowerCase()
  return (
    {
      applying: '申请中',
      deployed: '已部署',
      processing: '部署中',
      failed: '申请失败',
    }[key] || status || '-'
  )
}
