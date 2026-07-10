import http, { unwrapItems, withRefresh } from '@/shared/utils/request'
import type { ApiResponse, EdgeOneAccelerationDomain, EdgeOneZone } from '@/types'

const path = (value: string) => encodeURIComponent(value)
const providerBase = (provider: string) => `/edgeone/providers/${path(provider)}`
const zoneBase = (provider: string, zone: string) => `${providerBase(provider)}/zones/${path(zone)}`
const accelerationDomainBase = (provider: string, zone: string, domain: string) =>
  `${zoneBase(provider, zone)}/records/${path(domain)}`
const endpoints = {
  zones: (provider: string) => `${providerBase(provider)}/zones`,
  zone: (provider: string, zoneId: string) => `${providerBase(provider)}/zones/${path(zoneId)}`,
  accelerationDomains: (provider: string, zone: string) => `${zoneBase(provider, zone)}/records`,
  accelerationDomain: (provider: string, zone: string, domain: string) =>
    accelerationDomainBase(provider, zone, domain),
  accelerationDomainStatus: (provider: string, zone: string, domain: string) =>
    `${accelerationDomainBase(provider, zone, domain)}/status`,
  accelerationDomainCertificate: (provider: string, zone: string, domain: string) =>
    `${accelerationDomainBase(provider, zone, domain)}/certificate`,
  accelerationDomainCnameSyncs: (provider: string, zone: string, domain: string) =>
    `${accelerationDomainBase(provider, zone, domain)}/cname-sync`,
}

function normalizedPaging(options: Record<string, unknown> = {}, defaultPerPage = 20) {
  const page = Math.max(1, Number(options.page) || 1)
  const perPage = Math.max(1, Number(options.per_page) || defaultPerPage)
  return { page, per_page: perPage }
}

function edgeOneQuery(options: Record<string, unknown> = {}, defaultPerPage = 20) {
  const paging = normalizedPaging(options, defaultPerPage)
  return {
    offset: (paging.page - 1) * paging.per_page,
    limit: paging.per_page,
  }
}

export const edgeOneApi = {
  zones: async (provider: string, options: Record<string, unknown> = {}): Promise<ApiResponse<EdgeOneZone[]>> =>
    unwrapItems<EdgeOneZone[]>(
      await http.get(
        endpoints.zones(provider),
        withRefresh({ params: edgeOneQuery(options, 20), refresh: options?.refresh })
      )
    ),
  zone: (provider: string, zoneId: string): Promise<ApiResponse<EdgeOneZone>> =>
    http.get(endpoints.zone(provider, zoneId)),
  accelerationDomains: async (
    provider: string,
    zone: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<EdgeOneAccelerationDomain[]>> =>
    unwrapItems<EdgeOneAccelerationDomain[]>(
      await http.get(
        endpoints.accelerationDomains(provider, zone),
        withRefresh({ params: edgeOneQuery(options, 20), refresh: options?.refresh })
      )
    ),
  createAccelerationDomain: (
    provider: string,
    zone: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ) =>
    http.post(
      endpoints.accelerationDomains(provider, zone),
      data,
      options.autoSync ? { params: { auto_sync: 1 } } : {}
    ),
  updateAccelerationDomain: (provider: string, zone: string, domain: string, data: Record<string, unknown>) =>
    http.put(endpoints.accelerationDomain(provider, zone, domain), data),
  updateAccelerationDomainStatus: (provider: string, zone: string, domain: string, status: string) =>
    http.put(endpoints.accelerationDomainStatus(provider, zone, domain), { status }),
  updateCertificate: (provider: string, zone: string, domain: string, data: Record<string, unknown>) =>
    http.put(endpoints.accelerationDomainCertificate(provider, zone, domain), data),
  syncAccelerationDomainCname: (provider: string, zone: string, domain: string) =>
    http.post(endpoints.accelerationDomainCnameSyncs(provider, zone, domain)),
  deleteAccelerationDomain: (provider: string, zone: string, domain: string, options: Record<string, unknown> = {}) =>
    http.delete(
      endpoints.accelerationDomain(provider, zone, domain),
      options.skipCleanup ? { params: { auto_cleanup: 0 } } : {}
    ),
}
