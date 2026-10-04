import type { ProviderRepository } from '../providers/provider.repository.js'
import type { CloudflareZoneService } from '../cloudflare/cloudflare-zone.service.js'
import { parseCloudflareItemResponse, type CloudflareRouteConfig } from '../cloudflare/cloudflare-response.schema.js'
import {
  cloudflaredTunnelConfigCacheTag,
  providerCacheTag,
  withProviderCache,
} from '../../platform/cache/provider-cache.js'
import { ApiError } from '../../shared/http/api-error.js'
import { normalizeFqdn } from '../../shared/lib/values.js'
import { callProvider } from '../../shared/providers/provider-call.js'
import { asRecord, asRecordArray } from '../../shared/providers/response-guards.js'
import {
  buildDnsSideEffects,
  fromDnsOperationResult,
  type DnsOperationResult,
} from '../../shared/providers/side-effect-result.js'
import { invalidateTunnelRouteCache } from './tunnel.cache.js'
import { runSerial } from '../../shared/lib/serial-queue.js'
import { linkedCloudflareProviderId, resolveTunnelAccount, tunnelPath } from './tunnel-account.js'
import type { TunnelDnsService } from './tunnel-dns.service.js'

export interface TunnelRoute {
  hostname: string
  service: string
  path: string
  /** 上游规则里的其它字段（如 originRequest），写回时原样保留 */
  [key: string]: unknown
}

interface TunnelConfig {
  routes: TunnelRoute[]
  /** 兜底规则：写回时沿用原有配置，不强制重置 */
  catch_all: string
  version: number
}

const CATCH_ALL_SERVICE = 'http_status:404'

const sameRouteKey = (a: TunnelRoute, b: { hostname: string; path: string }) =>
  a.hostname === b.hostname && a.path === b.path

/** 同一隧道的 Ingress 写入必须串行，否则后写者会整体覆盖先写者 */
const ingressKey = (providerId: string, tunnelId: string) => `tunnel-ingress:${providerId}:${tunnelId}`

/** 隧道 Ingress 路由管理；写入路由后同步 Cloudflare CNAME */
export class TunnelRouteService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly zones: CloudflareZoneService,
    private readonly dns: TunnelDnsService
  ) {}

  async getConfig(providerId: string, tunnelId: string, refresh = false): Promise<TunnelConfig> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    const cached = await withProviderCache<TunnelConfig>({
      key: `cloudflared:tunnel_config:${providerId}:${tunnelId}`,
      tags: [
        providerCacheTag(providerId),
        providerCacheTag(account.cloudflare.id),
        cloudflaredTunnelConfigCacheTag(providerId, tunnelId),
      ],
      refresh,
      loader: async () => {
        const response = await callProvider(
          {
            code: 'cloudflared_route_list_failed',
            message: 'Cloudflare Tunnel route list failed',
            providerId,
            details: { tunnel_id: tunnelId },
          },
          () => account.client.get(`${tunnelPath(account.accountId, tunnelId)}/configurations`)
        )
        return presentConfig(parseCloudflareItemResponse(response).result)
      },
    })
    return cached.value
  }

  async addRoute(providerId: string, tunnelId: string, route: TunnelRoute): Promise<Record<string, unknown>> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const normalized = normalizeRoute(route)
    const zoneId = await this.requireZoneId(cfProviderId, normalized.hostname)
    return runSerial(ingressKey(providerId, tunnelId), async () => {
      const config = await this.fetchConfig(providerId, tunnelId)
      if (config.routes.some((existing) => sameRouteKey(existing, normalized))) throw routeExists(normalized)

      await this.writeIngress(providerId, tunnelId, [...config.routes, normalized], config.catch_all)
      invalidateTunnelRouteCache(providerId, tunnelId)

      const sync = await this.dns.ensureCname(cfProviderId, zoneId, normalized.hostname, tunnelId)
      return {
        ...normalized,
        side_effects: buildDnsSideEffects({ sync: fromDnsOperationResult(sync, '已执行 Cloudflare DNS 同步') }),
      }
    })
  }

  async updateRoute(
    providerId: string,
    tunnelId: string,
    originalHostname: string,
    originalPath: string,
    route: TunnelRoute
  ): Promise<Record<string, unknown>> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const normalized = normalizeRoute(route)
    const original = { hostname: normalizeFqdn(originalHostname), path: originalPath.trim() }
    const zoneId = await this.requireZoneId(cfProviderId, normalized.hostname)
    return runSerial(ingressKey(providerId, tunnelId), async () => {
      const config = await this.fetchConfig(providerId, tunnelId)
      const current = config.routes
      const index = current.findIndex((existing) => sameRouteKey(existing, original))
      if (index === -1) {
        throw new ApiError('cloudflared_route_not_found', `Route ${originalHostname}${originalPath} not found`, 404)
      }
      // 保留原规则的扩展字段
      const next = current.map((existing, i) => (i === index ? { ...existing, ...normalized } : existing))
      if (next.filter((existing) => sameRouteKey(existing, normalized)).length > 1) throw routeExists(normalized)

      await this.writeIngress(providerId, tunnelId, next, config.catch_all)
      // Ingress 已提交：先失效缓存，避免 DNS 副作用期间返回旧配置
      invalidateTunnelRouteCache(providerId, tunnelId)

      const sync = await this.dns.ensureCname(cfProviderId, zoneId, normalized.hostname, tunnelId)
      let cleanup: DnsOperationResult | undefined
      if (original.hostname !== normalized.hostname && !next.some((r) => r.hostname === original.hostname)) {
        cleanup = await this.dns.removeCname(cfProviderId, original.hostname, tunnelId)
      }
      return {
        ...normalized,
        side_effects: buildDnsSideEffects({
          sync: fromDnsOperationResult(sync, '已执行 Cloudflare DNS 同步'),
          cleanup: cleanup ? fromDnsOperationResult(cleanup, '已执行旧 Cloudflare DNS 清理') : undefined,
        }),
      }
    })
  }

  async deleteRoute(
    providerId: string,
    tunnelId: string,
    hostname: string,
    path: string
  ): Promise<Record<string, unknown>> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const target = { hostname: normalizeFqdn(hostname), path: path.trim() }
    return runSerial(ingressKey(providerId, tunnelId), async () => {
      const config = await this.fetchConfig(providerId, tunnelId)
      const current = config.routes
      const index = current.findIndex((existing) => sameRouteKey(existing, target))
      if (index === -1) throw new ApiError('cloudflared_route_not_found', `Route ${hostname}${path} not found`, 404)

      const next = current.filter((_, i) => i !== index)
      await this.writeIngress(providerId, tunnelId, next, config.catch_all)
      invalidateTunnelRouteCache(providerId, tunnelId)

      // 同主机名仍有其它路径路由时保留 CNAME
      const cleanup: DnsOperationResult = next.some((r) => r.hostname === target.hostname)
        ? { action: 'kept', reason: 'hostname_still_used' }
        : await this.dns.removeCname(cfProviderId, target.hostname, tunnelId)
      return {
        ...target,
        side_effects: buildDnsSideEffects({ cleanup: fromDnsOperationResult(cleanup, '已执行 Cloudflare DNS 清理') }),
      }
    })
  }

  private cfProviderIdOf(providerId: string): Promise<string> {
    return linkedCloudflareProviderId(this.providers, providerId)
  }

  // 变更前总是读取最新配置（含 catch_all），避免覆盖他处修改
  private fetchConfig(providerId: string, tunnelId: string): Promise<TunnelConfig> {
    return this.getConfig(providerId, tunnelId, true)
  }

  private async writeIngress(
    providerId: string,
    tunnelId: string,
    routes: TunnelRoute[],
    catchAll = CATCH_ALL_SERVICE
  ): Promise<void> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    // 原样保留规则里的扩展字段（originRequest 等），只更新本服务管理的字段
    const ingress = [
      ...routes.map((route) => {
        const { path, ...rest } = route
        return { ...rest, ...(path ? { path } : {}) }
      }),
      { service: catchAll },
    ]
    await callProvider(
      {
        code: 'cloudflared_route_write_failed',
        message: 'Cloudflare Tunnel route update failed',
        providerId,
        details: { tunnel_id: tunnelId },
      },
      () => account.client.put(`${tunnelPath(account.accountId, tunnelId)}/configurations`, { config: { ingress } })
    )
  }

  private async requireZoneId(cfProviderId: string, hostname: string): Promise<string> {
    const zoneId = await this.zones.bestMatchId(cfProviderId, hostname)
    if (zoneId === '') throw new ApiError('cloudflared_zone_not_found', `No Cloudflare zone matches ${hostname}`, 422)
    return zoneId
  }
}

function normalizeRoute(route: TunnelRoute): TunnelRoute {
  const hostname = normalizeFqdn(route.hostname)
  const service = route.service.trim()
  if (hostname === '' || service === '') {
    throw new ApiError('cloudflared_route_invalid', 'hostname and service are required', 422)
  }
  return { hostname, service, path: (route.path ?? '').trim() }
}

function routeExists(route: TunnelRoute): ApiError {
  return new ApiError('cloudflared_route_exists', `Route ${route.hostname}${route.path} already exists`, 409)
}

function presentConfig(config: CloudflareRouteConfig): TunnelConfig {
  const routes: TunnelRoute[] = []
  let catchAll = CATCH_ALL_SERVICE
  for (const rule of asRecordArray(asRecord(config.config).ingress)) {
    if (!rule.hostname) {
      if (typeof rule.service === 'string') catchAll = rule.service
      continue
    }
    if (typeof rule.hostname !== 'string' || typeof rule.service !== 'string') continue
    // 保留整条规则：写回时不能丢掉 originRequest 等扩展字段
    routes.push({
      ...rule,
      hostname: normalizeFqdn(rule.hostname),
      service: rule.service,
      path: typeof rule.path === 'string' ? rule.path.trim() : '',
    })
  }
  return { routes, catch_all: catchAll, version: Number(config.version ?? 0) || 0 }
}
