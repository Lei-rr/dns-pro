import http, { unwrapItems, withRefresh } from '@/shared/utils/request'
import type { ApiResponse, SaaSFallbackOrigin, SaaSHostname } from '@/types'

const path = (value: string) => encodeURIComponent(value)
const providerBase = (provider: string) => `/saas/providers/${path(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${path(zone)}`

const endpoints = {
  hostnames: (provider: string, zone: string) => `${zoneBase(provider, zone)}/hostnames`,
  hostname: (provider: string, zone: string, hostname: string) =>
    `${zoneBase(provider, zone)}/hostnames/${path(hostname)}`,
  refreshHostname: (provider: string, zone: string, hostname: string) =>
    `${zoneBase(provider, zone)}/hostnames/${path(hostname)}/refresh`,
  createHostname: (provider: string, zone: string) => `${zoneBase(provider, zone)}/hostnames`,
  fallbackOrigin: (provider: string, zone: string) => `${zoneBase(provider, zone)}/fallback-origin`,
  preferredDomains: () => `/saas/preferred-domains`,
  preferredDomain: (domain: string) => `/saas/preferred-domains/${path(domain)}`,
  preferredDomainsSort: () => `/saas/preferred-domains/sort`,
  preferredApply: (provider: string, zone: string) => `${zoneBase(provider, zone)}/preferred-apply`,
  preferredApplyPreview: (provider: string, zone: string) => `${zoneBase(provider, zone)}/preferred-apply/preview`,
  preferredApplyActive: (provider: string, zone: string) => `${zoneBase(provider, zone)}/preferred-apply/active`,
  preferredApplyJob: (jobId: string) => `/saas/preferred-apply/${path(jobId)}`,
  preferredApplyRetry: (jobId: string) => `/saas/preferred-apply/${path(jobId)}/retry`,
  batchDelete: (provider: string, zone: string) => `${zoneBase(provider, zone)}/batch/delete`,
  batchUpdate: (provider: string, zone: string) => `${zoneBase(provider, zone)}/batch/update`,
  batchActive: (provider: string, zone: string) => `${zoneBase(provider, zone)}/batch/active`,
  batchJob: (jobId: string) => `/saas/batch/${path(jobId)}`,
  batchRetry: (jobId: string) => `/saas/batch/${path(jobId)}/retry`,
}

export const saasApi = {
  hostnames: async (
    provider: string,
    zone: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<SaaSHostname[]>> =>
    unwrapItems<SaaSHostname[]>(
      await http.get(endpoints.hostnames(provider, zone), withRefresh({ params: options, refresh: options?.refresh }))
    ),
  hostname: async (
    provider: string,
    zone: string,
    hostname: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<SaaSHostname>> =>
    unwrapItems<SaaSHostname>(
      await http.get(
        endpoints.hostname(provider, zone, hostname),
        withRefresh({ params: options, refresh: options?.refresh })
      )
    ),
  refreshHostname: (provider: string, zone: string, hostname: string): Promise<ApiResponse<SaaSHostname>> =>
    http.post(endpoints.refreshHostname(provider, zone, hostname)),
  createHostname: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<SaaSHostname>> =>
    http.post(endpoints.createHostname(provider, zone), data, options.autoSync ? { params: { auto_sync: 1 } } : {}),
  updateHostname: (
    provider: string,
    zone: string,
    hostname: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<SaaSHostname>> =>
    http.put(endpoints.hostname(provider, zone, hostname), data, options.autoSync ? { params: { auto_sync: 1 } } : {}),
  deleteHostname: (
    provider: string,
    zone: string,
    hostname: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<SaaSHostname>> =>
    http.delete(
      endpoints.hostname(provider, zone, hostname),
      options.skipCleanup ? { params: { auto_cleanup: 0 } } : {}
    ),
  fallbackOrigin: (
    provider: string,
    zone: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<SaaSFallbackOrigin>> =>
    http.get(endpoints.fallbackOrigin(provider, zone), withRefresh({ refresh: options?.refresh })),
  setFallbackOrigin: (provider: string, zone: string, origin: string): Promise<ApiResponse<SaaSFallbackOrigin>> =>
    http.put(endpoints.fallbackOrigin(provider, zone), { origin }),
  deleteFallbackOrigin: (provider: string, zone: string) => http.delete(endpoints.fallbackOrigin(provider, zone)),
  preferredApplyPreview: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
  ) => http.post(endpoints.preferredApplyPreview(provider, zone), data),
  preferredApply: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
  ) => http.post(endpoints.preferredApply(provider, zone), data),
  preferredApplyActive: (provider: string, zone: string) => http.get(endpoints.preferredApplyActive(provider, zone)),
  preferredApplyJob: (jobId: string) => http.get(endpoints.preferredApplyJob(jobId)),
  preferredApplyRetry: (jobId: string) => http.post(endpoints.preferredApplyRetry(jobId)),
  batchDelete: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(endpoints.batchDelete(provider, zone), data),
  batchUpdate: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(endpoints.batchUpdate(provider, zone), data),
  batchActive: (provider: string, zone: string) => http.get(endpoints.batchActive(provider, zone)),
  batchJob: (jobId: string) => http.get(endpoints.batchJob(jobId)),
  batchRetry: (jobId: string) => http.post(endpoints.batchRetry(jobId)),
}

export const preferredDomainApi = {
  list: async (): Promise<ApiResponse<Array<{ domain: string }>>> =>
    unwrapItems<Array<{ domain: string }>>(await http.get(endpoints.preferredDomains())),
  create: (domain: string): Promise<ApiResponse<{ domain: string }>> =>
    http.post(endpoints.preferredDomains(), { domain }),
  rename: (oldDomain: string, newDomain: string): Promise<ApiResponse<{ domain: string }>> =>
    http.put(endpoints.preferredDomain(oldDomain), { domain: newDomain }),
  delete: (domain: string) => http.delete(endpoints.preferredDomain(domain)),
  sort: async (domains: string[]): Promise<ApiResponse<Array<{ domain: string }>>> =>
    unwrapItems<Array<{ domain: string }>>(await http.put(endpoints.preferredDomainsSort(), { domains })),
}
