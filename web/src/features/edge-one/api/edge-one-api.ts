import http, { POLL_TIMEOUT_MS, unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse } from '@/shared/api/types'
import type { EdgeOneAccelerationDomain, EdgeOneZone } from '@/features/edge-one/model/types'
import { encodePath } from '@/shared/lib/path'

const providerBase = (provider: string) => `/edgeone/providers/${encodePath(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${encodePath(zone)}`
const domainBase = (provider: string, zone: string, domain: string) =>
  `${zoneBase(provider, zone)}/records/${encodePath(domain)}`

/** 读接口选项：signal 由 useResourceQuery 的 queryFn 注入 */
type EdgeOneReadOptions = { refresh?: boolean; signal?: AbortSignal }

export const edgeOneApi = {
  zones: async (provider: string, options: EdgeOneReadOptions = {}): Promise<ApiResponse<EdgeOneZone[]>> =>
    unwrapItems<EdgeOneZone[]>(
      await http.get(`${providerBase(provider)}/zones`, {
        ...withRefresh({ refresh: options.refresh }),
        signal: options.signal,
      })
    ),
  zone: (provider: string, zoneId: string, options: EdgeOneReadOptions = {}): Promise<ApiResponse<EdgeOneZone>> =>
    http.get(`${providerBase(provider)}/zones/${encodePath(zoneId)}`, {
      ...withRefresh({ refresh: options.refresh }),
      signal: options.signal,
    }),
  accelerationDomains: async (
    provider: string,
    zone: string,
    options: EdgeOneReadOptions = {}
  ): Promise<ApiResponse<EdgeOneAccelerationDomain[]>> =>
    unwrapItems<EdgeOneAccelerationDomain[]>(
      await http.get(`${zoneBase(provider, zone)}/records`, {
        ...withRefresh({ refresh: options.refresh }),
        signal: options.signal,
      })
    ),
  createAccelerationDomain: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ) => http.post(`${zoneBase(provider, zone)}/records`, data, options.autoSync ? { params: { auto_sync: true } } : {}),
  updateAccelerationDomain: (provider: string, zone: string, domain: string, data: Record<string, unknown>) =>
    http.put(domainBase(provider, zone, domain), data),
  updateAccelerationDomainStatus: (provider: string, zone: string, domain: string, status: string) =>
    http.put(`${domainBase(provider, zone, domain)}/status`, { status }),
  updateCertificate: (provider: string, zone: string, domain: string, data: Record<string, unknown>) =>
    http.put(`${domainBase(provider, zone, domain)}/certificate`, data),
  deleteAccelerationDomain: (provider: string, zone: string, domain: string, options: Record<string, unknown> = {}) =>
    http.delete(domainBase(provider, zone, domain), options.skipCleanup ? { params: { auto_cleanup: false } } : {}),
  repairAccelerationDomainDns: (provider: string, zone: string, domain: string) =>
    http.post(`${domainBase(provider, zone, domain)}/dns-repair`),
  batchDisable: (provider: string, zone: string, data: { domains: string[] }) =>
    http.post(`${zoneBase(provider, zone)}/batch/disable`, data),
  batchDelete: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/batch/delete`, data),
  batchActive: (provider: string, zone: string) =>
    http.get(`${zoneBase(provider, zone)}/batch/active`, { timeout: POLL_TIMEOUT_MS }),
  batchJob: (provider: string, jobId: string) =>
    http.get(`${providerBase(provider)}/batch/${encodePath(jobId)}`, { timeout: POLL_TIMEOUT_MS }),
  batchRetry: (provider: string, jobId: string) =>
    http.post(`${providerBase(provider)}/batch/${encodePath(jobId)}/retry`),
}
