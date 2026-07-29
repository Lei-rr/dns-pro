import http, { unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse, CloudflaredRoute, CloudflaredTunnel, SideEffects } from '@/shared/types'
import { encodePath } from '@/shared/lib/path'

type RouteMutationResult = CloudflaredRoute & { side_effects?: SideEffects }

const providerBase = (provider: string) => `/cloudflared/providers/${encodePath(provider)}`
const tunnelBase = (provider: string, tunnelId: string) => `${providerBase(provider)}/tunnels/${encodePath(tunnelId)}`

export const cloudflaredApi = {
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
    http.post<RouteMutationResult>(`${tunnelBase(provider, tunnelId)}/routes`, data),
  updateRoute: (
    provider: string,
    tunnelId: string,
    data: Record<string, unknown>,
    originalHostname: string,
    originalPath: string,
  ) =>
    http.put<RouteMutationResult>(`${tunnelBase(provider, tunnelId)}/routes`, data, {
      params: { original_hostname: originalHostname, original_path: originalPath || '' },
    }),
  deleteRoute: (provider: string, tunnelId: string, hostname: string, pathValue: string) =>
    http.delete<RouteMutationResult>(`${tunnelBase(provider, tunnelId)}/routes`, {
      params: { hostname, path: pathValue || '' },
    }),
}

