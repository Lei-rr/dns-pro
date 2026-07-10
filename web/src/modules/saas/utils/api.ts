import http, { unwrapItems, withRefresh } from '@/shared/utils/request'
import type { ApiResponse } from '@/types'

const path = (value: string) => encodeURIComponent(value)
const providerBase = (provider: string) => `/saas/providers/${path(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${path(zone)}`

const endpoints = {
  hostnames: (provider: string, zone: string) => `${zoneBase(provider, zone)}/hostnames`,
  hostname: (provider: string, zone: string, hostname: string) => `${zoneBase(provider, zone)}/hostnames/${path(hostname)}`,
  refreshHostname: (provider: string, zone: string, hostname: string) => `${zoneBase(provider, zone)}/hostnames/${path(hostname)}/refresh`,
  createHostname: (provider: string, zone: string) => `${zoneBase(provider, zone)}/hostnames`,
  fallbackOrigin: (provider: string, zone: string) => `${zoneBase(provider, zone)}/fallback-origin`,
  preferredDomains: () => `/saas/preferred-domains`,
  preferredDomain: (domain: string) => `/saas/preferred-domains/${path(domain)}`,
  preferredDomainsSort: () => `/saas/preferred-domains/sort`,
}

export const saasApi = {
  hostnames: async (provider: string, zone: string, options: Record<string, unknown> = {}): Promise<ApiResponse<Record<string, unknown>[]>> => unwrapItems<Record<string, unknown>[]>(await http.get(endpoints.hostnames(provider, zone), withRefresh({ params: options, refresh: options?.refresh }))),
  hostname: async (provider: string, zone: string, hostname: string, options: Record<string, unknown> = {}): Promise<ApiResponse<Record<string, unknown>>> => unwrapItems<Record<string, unknown>>(await http.get(endpoints.hostname(provider, zone, hostname), withRefresh({ params: options, refresh: options?.refresh }))),
  refreshHostname: (provider: string, zone: string, hostname: string): Promise<ApiResponse<Record<string, unknown>>> => http.post(endpoints.refreshHostname(provider, zone, hostname)) as Promise<ApiResponse<Record<string, unknown>>>,
  createHostname: (provider: string, zone: string, data: Record<string, unknown>, options: Record<string, unknown> = {}) => http.post(endpoints.createHostname(provider, zone), data, options.autoSync ? { params: { auto_sync: 1 } } : {}),
  updateHostname: (provider: string, zone: string, hostname: string, data: Record<string, unknown>, options: Record<string, unknown> = {}) => http.put(endpoints.hostname(provider, zone, hostname), data, options.autoSync ? { params: { auto_sync: 1 } } : {}),
  deleteHostname: (provider: string, zone: string, hostname: string, options: Record<string, unknown> = {}) => http.delete(endpoints.hostname(provider, zone, hostname), options.skipCleanup ? { params: { auto_cleanup: 0 } } : {}),
  fallbackOrigin: (provider: string, zone: string, options: Record<string, unknown> = {}): Promise<ApiResponse<Record<string, unknown>>> => http.get(endpoints.fallbackOrigin(provider, zone), withRefresh({ refresh: options?.refresh })) as Promise<ApiResponse<Record<string, unknown>>>,
  setFallbackOrigin: (provider: string, zone: string, origin: string): Promise<ApiResponse<Record<string, unknown>>> => http.put(endpoints.fallbackOrigin(provider, zone), { origin }) as Promise<ApiResponse<Record<string, unknown>>>,
  deleteFallbackOrigin: (provider: string, zone: string) => http.delete(endpoints.fallbackOrigin(provider, zone)),
}

export const preferredDomainApi = {
  list: async (): Promise<ApiResponse<Array<{ domain: string }>>> => unwrapItems<Array<{ domain: string }>>(await http.get(endpoints.preferredDomains())),
  create: (domain: string): Promise<ApiResponse<{ domain: string }>> => http.post(endpoints.preferredDomains(), { domain }) as Promise<ApiResponse<{ domain: string }>>,
  rename: (oldDomain: string, newDomain: string): Promise<ApiResponse<{ domain: string }>> => http.put(endpoints.preferredDomain(oldDomain), { domain: newDomain }) as Promise<ApiResponse<{ domain: string }>>,
  delete: (domain: string) => http.delete(endpoints.preferredDomain(domain)),
  sort: async (domains: string[]): Promise<ApiResponse<Array<{ domain: string }>>> => unwrapItems<Array<{ domain: string }>>(await http.put(endpoints.preferredDomainsSort(), { domains })),
}
