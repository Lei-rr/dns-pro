import http, { unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse, CloudflaredRoute, CloudflaredTunnel, Zone } from '@/shared/types'
import { encodePath } from '@/shared/lib/path'

const providerBase = (provider: string) => `/cloudflared/providers/${encodePath(provider)}`
const tunnelBase = (provider: string, tunnelId: string) => `${providerBase(provider)}/tunnels/${encodePath(tunnelId)}`

export const cloudflaredApi = {
  zones: async (provider: string, options: Record<string, unknown> = {}): Promise<ApiResponse<Zone[]>> =>
    unwrapItems<Zone[]>(await http.get(`${providerBase(provider)}/zones`, withRefresh({ refresh: options?.refresh }))),
  tunnels: async (provider: string, options: Record<string, unknown> = {}): Promise<ApiResponse<CloudflaredTunnel[]>> =>
    unwrapItems<CloudflaredTunnel[]>(
      await http.get(`${providerBase(provider)}/tunnels`, withRefresh({ refresh: options?.refresh })),
    ),
  tunnel: (provider: string, tunnelId: string, options: Record<string, unknown> = {}) =>
    http.get<CloudflaredTunnel>(tunnelBase(provider, tunnelId), withRefresh({ refresh: options?.refresh })),
  createTunnel: (provider: string, name: string) =>
    http.post<{ tunnel: CloudflaredTunnel }>(`${providerBase(provider)}/tunnels`, { name }),
  deleteTunnel: (provider: string, tunnelId: string) => http.delete(tunnelBase(provider, tunnelId)),
  tunnelToken: (provider: string, tunnelId: string) =>
    http.get<{ token: string }>(`${tunnelBase(provider, tunnelId)}/token`),
  rotateToken: (provider: string, tunnelId: string) =>
    http.post<{ token: string }>(`${tunnelBase(provider, tunnelId)}/token/rotate`),
  routes: (provider: string, tunnelId: string) =>
    http.get<{ routes: CloudflaredRoute[] }>(`${tunnelBase(provider, tunnelId)}/routes`),
  addRoute: (provider: string, tunnelId: string, data: Record<string, unknown>) =>
    http.post<CloudflaredRoute>(`${tunnelBase(provider, tunnelId)}/routes`, data),
  updateRoute: (
    provider: string,
    tunnelId: string,
    data: Record<string, unknown>,
    originalHostname: string,
    originalPath: string,
  ) =>
    http.put<CloudflaredRoute>(`${tunnelBase(provider, tunnelId)}/routes`, data, {
      params: { original_hostname: originalHostname, original_path: originalPath || '' },
    }),
  deleteRoute: (provider: string, tunnelId: string, hostname: string, pathValue: string, zoneId: string) =>
    http.delete(`${tunnelBase(provider, tunnelId)}/routes`, {
      params: { hostname, path: pathValue || '', zone_id: zoneId || '' },
    }),
}

