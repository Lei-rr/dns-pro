import http, { unwrapItems, withRefresh } from '@/shared/api/http'
import type { ApiResponse, SideEffects } from '@/shared/api/types'
import type { Tunnel as CloudflaredTunnel, TunnelRoute as CloudflaredRoute } from '@/features/tunnels/model/types'
import { encodePath } from '@/shared/lib/path'

type TunnelCreateResult = {
  tunnel: CloudflaredTunnel
  token: string | null
}

type RouteMutationResult = CloudflaredRoute & { side_effects?: SideEffects }

/** 路由写入载荷：与 cloudflaredRouteStoreSchema / cloudflaredRouteUpdateSchema 的 body 对齐 */
export type TunnelRouteInput = { hostname: string; service: string; path?: string }

type RefreshOptions = { refresh?: boolean }

const providerBase = (provider: string) => `/cloudflared/providers/${encodePath(provider)}`
const tunnelBase = (provider: string, tunnelId: string) => `${providerBase(provider)}/tunnels/${encodePath(tunnelId)}`

export const cloudflaredApi = {
  tunnels: async (provider: string, options: RefreshOptions = {}): Promise<ApiResponse<CloudflaredTunnel[]>> =>
    unwrapItems<CloudflaredTunnel[]>(
      await http.get(`${providerBase(provider)}/tunnels`, withRefresh({ refresh: options.refresh }))
    ),
  tunnel: (provider: string, tunnelId: string, options: RefreshOptions = {}) =>
    http.get<CloudflaredTunnel>(tunnelBase(provider, tunnelId), withRefresh({ refresh: options.refresh })),
  createTunnel: (provider: string, name: string) =>
    http.post<TunnelCreateResult>(`${providerBase(provider)}/tunnels`, { name }),
  deleteTunnel: (provider: string, tunnelId: string) => http.delete(tunnelBase(provider, tunnelId)),
  tunnelToken: (provider: string, tunnelId: string) =>
    http.get<{ token: string }>(`${tunnelBase(provider, tunnelId)}/token`),
  rotateToken: (provider: string, tunnelId: string) =>
    http.post<{ token: string }>(`${tunnelBase(provider, tunnelId)}/token/rotate`),
  routes: (provider: string, tunnelId: string, options: RefreshOptions = {}) =>
    http.get<{ routes: CloudflaredRoute[] }>(
      `${tunnelBase(provider, tunnelId)}/routes`,
      withRefresh({ refresh: options.refresh })
    ),
  addRoute: (provider: string, tunnelId: string, data: TunnelRouteInput) =>
    http.post<RouteMutationResult>(`${tunnelBase(provider, tunnelId)}/routes`, data),
  /** 与 SaaS / EdgeOne 的 dns-repair 同义：为隧道全部路由补齐/修正 CNAME */
  repairRoutes: (provider: string, tunnelId: string) =>
    http.post<{ tunnel_id: string; hostnames: Array<Record<string, unknown>>; side_effects?: SideEffects }>(
      `${tunnelBase(provider, tunnelId)}/routes/repair`
    ),
  updateRoute: (
    provider: string,
    tunnelId: string,
    data: TunnelRouteInput,
    originalHostname: string,
    originalPath: string
  ) =>
    http.put<RouteMutationResult>(`${tunnelBase(provider, tunnelId)}/routes`, data, {
      params: { original_hostname: originalHostname, original_path: originalPath || '' },
    }),
  deleteRoute: (provider: string, tunnelId: string, hostname: string, pathValue: string) =>
    http.delete<RouteMutationResult>(`${tunnelBase(provider, tunnelId)}/routes`, {
      params: { hostname, path: pathValue || '' },
    }),
}
