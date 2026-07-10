import http, { unwrapItems, withRefresh } from '@/shared/utils/request'
import type { ApiResponse } from '@/types'

const path = (value: string) => encodeURIComponent(value)
const providerBase = (provider: string) => `/cloudflared/providers/${path(provider)}`
const tunnelBase = (provider: string, tunnelId: string) => `${providerBase(provider)}/tunnels/${path(tunnelId)}`

const endpoints = {
  zones: (provider: string) => `${providerBase(provider)}/zones`,
  tunnels: (provider: string) => `${providerBase(provider)}/tunnels`,
  tunnel: (provider: string, tunnelId: string) => tunnelBase(provider, tunnelId),
  token: (provider: string, tunnelId: string) => `${tunnelBase(provider, tunnelId)}/token`,
  tokenRotate: (provider: string, tunnelId: string) => `${tunnelBase(provider, tunnelId)}/token/rotate`,
  routes: (provider: string, tunnelId: string) => `${tunnelBase(provider, tunnelId)}/routes`,
}

export const cloudflaredApi = {
  zones: async (
    provider: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<Record<string, unknown>[]>> =>
    unwrapItems<Record<string, unknown>[]>(
      await http.get(endpoints.zones(provider), withRefresh({ refresh: options?.refresh }))
    ),
  tunnels: async (
    provider: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<Record<string, unknown>[]>> =>
    unwrapItems<Record<string, unknown>[]>(
      await http.get(endpoints.tunnels(provider), withRefresh({ refresh: options?.refresh }))
    ),
  tunnel: (
    provider: string,
    tunnelId: string,
    options: Record<string, unknown> = {}
  ): Promise<ApiResponse<Record<string, unknown>>> =>
    http.get(endpoints.tunnel(provider, tunnelId), withRefresh({ refresh: options?.refresh })),
  createTunnel: (provider: string, name: string): Promise<ApiResponse<Record<string, unknown>>> =>
    http.post(endpoints.tunnels(provider), { name }),
  deleteTunnel: (provider: string, tunnelId: string) => http.delete(endpoints.tunnel(provider, tunnelId)),
  tunnelToken: (provider: string, tunnelId: string): Promise<ApiResponse<Record<string, unknown>>> =>
    http.get(endpoints.token(provider, tunnelId)),
  rotateToken: (provider: string, tunnelId: string): Promise<ApiResponse<Record<string, unknown>>> =>
    http.post(endpoints.tokenRotate(provider, tunnelId)),
  routes: (provider: string, tunnelId: string): Promise<ApiResponse<Record<string, unknown>>> =>
    http.get(endpoints.routes(provider, tunnelId)),
  addRoute: (
    provider: string,
    tunnelId: string,
    data: Record<string, unknown>
  ): Promise<ApiResponse<Record<string, unknown>>> => http.post(endpoints.routes(provider, tunnelId), data),
  updateRoute: (
    provider: string,
    tunnelId: string,
    data: Record<string, unknown>,
    originalHostname: string,
    originalPath: string
  ): Promise<ApiResponse<Record<string, unknown>>> =>
    http.put(endpoints.routes(provider, tunnelId), data, {
      params: { original_hostname: originalHostname, original_path: originalPath || '' },
    }),
  deleteRoute: (provider: string, tunnelId: string, hostname: string, path: string, zoneId: string) =>
    http.delete(endpoints.routes(provider, tunnelId), {
      params: { hostname, path: path || '', zone_id: zoneId || '' },
    }),
}
