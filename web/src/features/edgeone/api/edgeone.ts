import http, { unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse, EdgeOneAccelerationDomain, EdgeOneZone } from '@/shared/types'
import { encodePath } from '@/shared/lib/path'

const providerBase = (provider: string) => `/edgeone/providers/${encodePath(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${encodePath(zone)}`
const domainBase = (provider: string, zone: string, domain: string) =>
  `${zoneBase(provider, zone)}/records/${encodePath(domain)}`

export const edgeOneApi = {
  zones: async (provider: string, options: Record<string, unknown> = {}): Promise<ApiResponse<EdgeOneZone[]>> =>
    unwrapItems<EdgeOneZone[]>(
      await http.get(`${providerBase(provider)}/zones`, withRefresh({ refresh: options?.refresh })),
    ),
  zone: (provider: string, zoneId: string, options: Record<string, unknown> = {}): Promise<ApiResponse<EdgeOneZone>> =>
    http.get(
      `${providerBase(provider)}/zones/${encodePath(zoneId)}`,
      withRefresh({ refresh: options?.refresh }),
    ),
  accelerationDomains: async (
    provider: string,
    zone: string,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<EdgeOneAccelerationDomain[]>> =>
    unwrapItems<EdgeOneAccelerationDomain[]>(
      await http.get(
        `${zoneBase(provider, zone)}/records`,
        withRefresh({ refresh: options?.refresh }),
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
      options.autoSync ? { params: { auto_sync: true } } : {},
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
      options.skipCleanup ? { params: { auto_cleanup: false } } : {},
    ),
  syncAccelerationDomainCname: (provider: string, zone: string, domain: string) =>
    http.post(`${domainBase(provider, zone, domain)}/cname-sync`),
  batchDisable: (provider: string, zone: string, data: { domains: string[] }) =>
    http.post(`${zoneBase(provider, zone)}/batch/disable`, data),
  batchDelete: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/batch/delete`, data),
  batchActive: (provider: string, zone: string) => http.get(`${zoneBase(provider, zone)}/batch/active`),
  batchJob: (provider: string, jobId: string) => http.get(`${providerBase(provider)}/batch/${encodePath(jobId)}`),
  batchRetry: (provider: string, jobId: string) => http.post(`${providerBase(provider)}/batch/${encodePath(jobId)}/retry`),
}

