import http, { POLL_TIMEOUT_MS, unwrapItem, unwrapList, withRefresh } from '@/shared/api/http'
import type { ApiResponse, ApiResult } from '@/shared/api/types'
import type { JobLike } from '@/shared/job'
import type { SaaSDnsRepairResult, SaaSFallbackOrigin, SaaSHostname } from '@/features/saas/model/types'
import { encodePath } from '@/shared/lib/path'

const providerBase = (provider: string) => `/saas/providers/${encodePath(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${encodePath(zone)}`

/** 读接口选项：signal 由 useResourceQuery 的 queryFn 注入 */
type SaasReadOptions = { refresh?: boolean; signal?: AbortSignal }

/** 详情端点契约守卫：响应必须是一条主机名对象，形状不符由解包器抛错而不是被透传 */
function isSaaSHostname(value: unknown): value is SaaSHostname {
  return typeof value === 'object' && value !== null && 'hostname' in value && typeof value.hostname === 'string'
}

/**
 * 优选切换请求体：预览与创建共用。
 * 不含 dry_run——预览走独立的 preview 端点，创建端点收到 dry_run 不会再退化成预览。
 */
export type PreferredApplyPayload = { preferred_domain: string; only_auto_preferred: boolean }

export const saasApi = {
  hostnames: async (
    provider: string,
    zone: string,
    options: SaasReadOptions = {}
  ): Promise<ApiResponse<SaaSHostname[]>> =>
    unwrapList<SaaSHostname>(
      await http.get(`${zoneBase(provider, zone)}/hostnames`, {
        ...withRefresh({ refresh: options.refresh }),
        signal: options.signal,
      })
    ),
  hostname: async (
    provider: string,
    zone: string,
    hostname: string,
    options: SaasReadOptions = {}
  ): Promise<ApiResponse<SaaSHostname>> =>
    unwrapItem(
      await http.get(`${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}`, {
        ...withRefresh({ refresh: options.refresh }),
        signal: options.signal,
      }),
      isSaaSHostname
    ),
  createHostname: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ): Promise<ApiResult<SaaSHostname>> =>
    http.post(`${zoneBase(provider, zone)}/hostnames`, data, options.autoSync ? { params: { auto_sync: true } } : {}),
  updateHostname: (
    provider: string,
    zone: string,
    hostname: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ): Promise<ApiResult<SaaSHostname>> =>
    http.put(
      `${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}`,
      data,
      options.autoSync ? { params: { auto_sync: true } } : {}
    ),
  deleteHostname: (
    provider: string,
    zone: string,
    hostname: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResult<SaaSHostname>> =>
    http.delete(
      `${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}`,
      options.skipCleanup ? { params: { auto_cleanup: false } } : {}
    ),
  reconcileHostname: (provider: string, zone: string, hostname: string): Promise<ApiResult<SaaSHostname>> =>
    http.post(`${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}/reconcile`),
  repairHostnameDns: (provider: string, zone: string, hostname: string): Promise<ApiResult<SaaSDnsRepairResult>> =>
    http.post(`${zoneBase(provider, zone)}/hostnames/${encodePath(hostname)}/dns-repair`),
  fallbackOrigin: (
    provider: string,
    zone: string,
    options: SaasReadOptions = {}
  ): Promise<ApiResult<SaaSFallbackOrigin>> =>
    http.get(`${zoneBase(provider, zone)}/fallback-origin`, {
      ...withRefresh({ refresh: options.refresh }),
      signal: options.signal,
    }),
  setFallbackOrigin: (provider: string, zone: string, origin: string): Promise<ApiResult<SaaSFallbackOrigin>> =>
    http.put(`${zoneBase(provider, zone)}/fallback-origin`, { origin }),
  deleteFallbackOrigin: (provider: string, zone: string) => http.delete(`${zoneBase(provider, zone)}/fallback-origin`),
  preferredApplyPreview: (provider: string, zone: string, data: PreferredApplyPayload) =>
    http.post(`${zoneBase(provider, zone)}/preferred-apply/preview`, data),
  preferredApply: (provider: string, zone: string, data: PreferredApplyPayload) =>
    http.post(`${zoneBase(provider, zone)}/preferred-apply`, data),
  preferredApplyActive: (provider: string, zone: string, options: { timeout?: number } = {}) =>
    http.get<JobLike>(`${zoneBase(provider, zone)}/preferred-apply/active`, {
      timeout: options.timeout ?? POLL_TIMEOUT_MS,
    }),
  // 任务端点挂在服务商作用域下：归属校验要求路径带 providerId
  preferredApplyJob: (provider: string, jobId: string) =>
    http.get<JobLike>(`${providerBase(provider)}/preferred-apply/${encodePath(jobId)}`, { timeout: POLL_TIMEOUT_MS }),
  preferredApplyRetry: (provider: string, jobId: string) =>
    http.post(`${providerBase(provider)}/preferred-apply/${encodePath(jobId)}/retry`),
  batchDelete: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/batch/delete`, data),
  batchUpdate: (provider: string, zone: string, data: Record<string, unknown>) =>
    http.post(`${zoneBase(provider, zone)}/batch/update`, data),
  batchActive: (provider: string, zone: string, options: { timeout?: number } = {}) =>
    http.get<JobLike>(`${zoneBase(provider, zone)}/batch/active`, { timeout: options.timeout ?? POLL_TIMEOUT_MS }),
  batchJob: (provider: string, jobId: string) =>
    http.get<JobLike>(`${providerBase(provider)}/batch/${encodePath(jobId)}`, { timeout: POLL_TIMEOUT_MS }),
  batchRetry: (provider: string, jobId: string) =>
    http.post(`${providerBase(provider)}/batch/${encodePath(jobId)}/retry`),
}

export const preferredDomainApi = {
  list: async (): Promise<ApiResponse<Array<{ domain: string }>>> =>
    unwrapList<{ domain: string }>(await http.get('/saas/preferred-domains')),
  create: (domain: string): Promise<ApiResult<{ domain: string }>> => http.post('/saas/preferred-domains', { domain }),
  rename: (oldDomain: string, newDomain: string): Promise<ApiResult<{ domain: string }>> =>
    http.put(`/saas/preferred-domains/${encodePath(oldDomain)}`, { domain: newDomain }),
  delete: (domain: string) => http.delete(`/saas/preferred-domains/${encodePath(domain)}`),
  sort: async (domains: string[]): Promise<ApiResponse<Array<{ domain: string }>>> =>
    unwrapList<{ domain: string }>(await http.put('/saas/preferred-domains/sort-order', { domains })),
}
