import http, { unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse, SaaSFallbackOrigin, SaaSHostname } from '@/shared/types'
import { encodePath } from '@/shared/lib/path'

const providerBase = (provider: string) => `/saas/providers/${encodePath(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${encodePath(zone)}`

export const saasApi = {
  hostnames: async (
    provider: string,
    zone: string,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<SaaSHostname[]>> =>
    unwrapItems<SaaSHostname[]>(
      await http.get(`${zoneBase(provider, zone)}/hostnames`, withRefresh({ params: options, refresh: options?.refresh })),
    ),
  hostname: async (
    provider: string,
    zone: string,
    hostname: string,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<SaaSHostname>> =>
    unwrapItems<SaaSHostname>(
      await http.get(
        `${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}`,
        withRefresh({ params: options, refresh: options?.refresh }),
      ),
    ),
  createHostname: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<SaaSHostname>> =>
    http.post(`${zoneBase(provider, zone)}/hostnames`, data, options.autoSync ? { params: { auto_sync: 1 } } : {}),
  updateHostname: (
    provider: string,
    zone: string,
    hostname: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<SaaSHostname>> =>
    http.put(
      `${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}`,
      data,
      options.autoSync ? { params: { auto_sync: 1 } } : {},
    ),
  deleteHostname: (
    provider: string,
    zone: string,
    hostname: string,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<SaaSHostname>> =>
    http.delete(
      `${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}`,
      options.skipCleanup ? { params: { auto_cleanup: 0 } } : {},
    ),
  refreshHostname: (provider: string, zone: string, hostname: string): Promise<ApiResponse<SaaSHostname>> =>
    http.post(`${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}/refresh`),
  fallbackOrigin: (
    provider: string,
    zone: string,
    options: Record<string, unknown> = {},
  ): Promise<ApiResponse<SaaSFallbackOrigin>> =>
    http.get(`${zoneBase(provider, zone)}/fallback-origin`, withRefresh({ refresh: options?.refresh })),
  setFallbackOrigin: (provider: string, zone: string, origin: string): Promise<ApiResponse<SaaSFallbackOrigin>> =>
    http.put(`${zoneBase(provider, zone)}/fallback-origin`, { origin }),
  deleteFallbackOrigin: (provider: string, zone: string) =>
    http.delete(`${zoneBase(provider, zone)}/fallback-origin`),
  preferredApplyPreview: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/preferred-apply/preview`, data),
  preferredApply: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/preferred-apply`, data),
  preferredApplyActive: (provider: string, zone: string) =>
    http.get(`${zoneBase(provider, zone)}/preferred-apply/active`),
  preferredApplyJob: (jobId: string) => http.get(`/saas/preferred-apply/${encodePath(jobId)}`),
  preferredApplyRetry: (jobId: string) => http.post(`/saas/preferred-apply/${encodePath(jobId)}/retry`),
  batchDelete: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/batch/delete`, data),
  batchUpdate: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/batch/update`, data),
  batchActive: (provider: string, zone: string) => http.get(`${zoneBase(provider, zone)}/batch/active`),
  batchJob: (jobId: string) => http.get(`/saas/batch/${encodePath(jobId)}`),
  batchRetry: (jobId: string) => http.post(`/saas/batch/${encodePath(jobId)}/retry`),
}

export const preferredDomainApi = {
  list: async (): Promise<ApiResponse<Array<{ domain: string }>>> =>
    unwrapItems<Array<{ domain: string }>>(await http.get('/saas/preferred-domains')),
  create: (domain: string): Promise<ApiResponse<{ domain: string }>> =>
    http.post('/saas/preferred-domains', { domain }),
  rename: (oldDomain: string, newDomain: string): Promise<ApiResponse<{ domain: string }>> =>
    http.put(`/saas/preferred-domains/${encodePath(oldDomain)}`, { domain: newDomain }),
  delete: (domain: string) => http.delete(`/saas/preferred-domains/${encodePath(domain)}`),
  sort: async (domains: string[]): Promise<ApiResponse<Array<{ domain: string }>>> =>
    unwrapItems<Array<{ domain: string }>>(await http.put('/saas/preferred-domains/sort', { domains })),
}
