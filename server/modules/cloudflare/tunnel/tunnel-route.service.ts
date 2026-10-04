import { parseCloudflareItemResponse, type CloudflareRouteConfig } from '../cloudflare-response.schema.js'
import {
  cloudflaredTunnelConfigCacheTag,
  providerCacheTag,
  withProviderCache,
} from '../../../core/cache/provider-cache.js'
import { ApiError } from '../../../core/http/api-error.js'
import { errorMessage, normalizeFqdn } from '../../../shared/values.js'
import { callProvider } from '../../../core/providers/provider-call.js'
import { asRecord, asRecordArray } from '../../../core/providers/response-guards.js'
import {
  buildDnsSideEffects,
  fromDnsOperationResult,
  type DnsSideEffect,
  type DnsOperationResult,
} from '../../../core/providers/side-effect-result.js'
import { invalidateTunnelRouteCache } from './tunnel.cache.js'
import { runSerial } from '../../../shared/serial-queue.js'
import { tunnelPath } from './tunnel-path.js'
import type { CloudflareAccess } from '../access.js'
import type { ZoneCatalog, ZoneRef } from '../zone-catalog.js'
import type { TunnelDnsService } from './tunnel-dns.service.js'

interface TunnelRoute {
  hostname: string
  service: string
  path: string
  /** 上游规则里的其它字段（如 originRequest），写回时原样保留 */
  [key: string]: unknown
}

/**
 * ingress 之外的 config 级字段的载体。
 * PUT configurations 是整对象覆盖语义，写回时不带上就会被上游清空；
 * 该字段只服务于写回，故用 Symbol 承载，不进入 GET /routes 的响应契约（JSON 序列化会忽略 Symbol 键）。
 */
const CONFIG_REST = Symbol('tunnelConfigRest')

interface TunnelConfig {
  routes: TunnelRoute[]
  /** 兜底规则：写回时沿用原有配置，不强制重置 */
  catch_all: string
  version: number
  /** ingress 之外的 config 级字段（originRequest、warp-routing 等），见 CONFIG_REST */
  [CONFIG_REST]?: Record<string, unknown>
}

const CATCH_ALL_SERVICE = 'http_status:404'

const sameRouteKey = (a: TunnelRoute, b: { hostname: string; path: string }) =>
  a.hostname === b.hostname && a.path === b.path

/** 同一隧道的 Ingress 写入必须串行，否则后写者会整体覆盖先写者 */
const ingressKey = (providerId: string, tunnelId: string) => `tunnel-ingress:${providerId}:${tunnelId}`

/** 隧道 Ingress 路由管理；写入路由后同步 Cloudflare CNAME */
export class TunnelRouteService {
  constructor(
    private readonly access: CloudflareAccess,
    private readonly catalog: ZoneCatalog,
    private readonly dns: TunnelDnsService
  ) {}

  async getConfig(providerId: string, tunnelId: string, refresh = false): Promise<TunnelConfig> {
    const account = await this.access.forTunnel(providerId)
    const cached = await withProviderCache<TunnelConfig>({
      key: `cloudflared:tunnel_config:${providerId}:${tunnelId}`,
      tags: [
        providerCacheTag(providerId),
        providerCacheTag(account.provider.id),
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
    const zone = await this.requireZone(cfProviderId, normalized.hostname)
    return runSerial(ingressKey(providerId, tunnelId), async () => {
      const config = await this.fetchConfig(providerId, tunnelId)
      if (config.routes.some((existing) => sameRouteKey(existing, normalized))) throw routeExists(normalized)

      await this.writeIngress(providerId, tunnelId, { ...config, routes: [...config.routes, normalized] })
      invalidateTunnelRouteCache(providerId, tunnelId)

      const sync = await this.dns.ensureCname(zone, normalized.hostname, tunnelId)
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
    const zone = await this.requireZone(cfProviderId, normalized.hostname)
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

      await this.writeIngress(providerId, tunnelId, { ...config, routes: next })
      // Ingress 已提交：先失效缓存，避免 DNS 副作用期间返回旧配置
      invalidateTunnelRouteCache(providerId, tunnelId)

      const sync = await this.dns.ensureCname(zone, normalized.hostname, tunnelId)
      let cleanup: DnsOperationResult | undefined
      if (original.hostname !== normalized.hostname && !next.some((r) => r.hostname === original.hostname)) {
        cleanup = await this.removeCnameIfResolvable(cfProviderId, original.hostname, tunnelId)
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
      await this.writeIngress(providerId, tunnelId, { ...config, routes: next })
      invalidateTunnelRouteCache(providerId, tunnelId)

      // 同主机名仍有其它路径路由时保留 CNAME
      const cleanup: DnsOperationResult = next.some((r) => r.hostname === target.hostname)
        ? { action: 'kept', reason: 'hostname_still_used' }
        : await this.removeCnameIfResolvable(cfProviderId, target.hostname, tunnelId)
      return {
        ...target,
        side_effects: buildDnsSideEffects({ cleanup: fromDnsOperationResult(cleanup, '已执行 Cloudflare DNS 清理') }),
      }
    })
  }

  /**
   * 重新确保该隧道每条 Ingress 路由的 CNAME 指向隧道（幂等，不改 Ingress）。
   * 与 SaaS/EdgeOne 的 dns-repair 同义：单条失败/冲突不中断其它主机名，逐条如实返回。
   */
  async repairRoutes(providerId: string, tunnelId: string): Promise<Record<string, unknown>> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    return runSerial(ingressKey(providerId, tunnelId), async () => {
      const config = await this.fetchConfig(providerId, tunnelId)
      const hostnames = [...new Set(config.routes.map((route) => route.hostname))]
      const results: Array<Record<string, unknown>> = []
      for (const hostname of hostnames) {
        results.push(await this.repairHostname(cfProviderId, hostname, tunnelId))
      }
      return {
        tunnel_id: tunnelId,
        hostnames: results,
        side_effects: buildDnsSideEffects({ sync: repairSideEffect(tunnelId, results) }),
      }
    })
  }

  /** 单个主机名：站点解析失败只影响本条，不中断整体修复 */
  private async repairHostname(
    cfProviderId: string,
    hostname: string,
    tunnelId: string
  ): Promise<Record<string, unknown>> {
    try {
      const zone = await this.catalog.resolve(cfProviderId, hostname)
      if (!zone) return { hostname, zone_id: '', action: 'skipped', reason: 'zone_not_found' }
      return { hostname, zone_id: zone.zoneId, ...(await this.dns.ensureCname(zone, hostname, tunnelId)) }
    } catch (error) {
      return { hostname, action: 'failed', error: errorMessage(error) }
    }
  }

  private cfProviderIdOf(providerId: string): Promise<string> {
    return this.access.linkedProviderId(providerId)
  }

  // 变更前总是读取最新配置（含 catch_all），避免覆盖他处修改
  private fetchConfig(providerId: string, tunnelId: string): Promise<TunnelConfig> {
    return this.getConfig(providerId, tunnelId, true)
  }

  private async writeIngress(providerId: string, tunnelId: string, config: TunnelConfig): Promise<void> {
    const account = await this.access.forTunnel(providerId)
    // 原样保留规则里的扩展字段（originRequest 等），只更新本服务管理的字段
    const ingress = [
      ...config.routes.map((route) => {
        const { path, ...rest } = route
        return { ...rest, ...(path ? { path } : {}) }
      }),
      { service: config.catch_all },
    ]
    await callProvider(
      {
        code: 'cloudflared_route_write_failed',
        message: 'Cloudflare Tunnel route update failed',
        providerId,
        details: { tunnel_id: tunnelId },
      },
      () =>
        account.client.put(`${tunnelPath(account.accountId, tunnelId)}/configurations`, {
          // config 为整对象覆盖：ingress 之外的上游字段必须一并回写，否则会被清空
          config: { ...(config[CONFIG_REST] ?? {}), ingress },
        })
    )
  }

  /** 站点解析失败时不清理（沿用原 zone_not_found 语义） */
  private async removeCnameIfResolvable(cfProviderId: string, hostname: string, tunnelId: string) {
    try {
      const zone = await this.catalog.resolve(cfProviderId, hostname)
      if (!zone) return { action: 'skipped', reason: 'zone_not_found' }
      return await this.dns.removeCname(zone, hostname, tunnelId)
    } catch (error) {
      return { action: 'failed', error: errorMessage(error) }
    }
  }

  private async requireZone(cfProviderId: string, hostname: string): Promise<ZoneRef> {
    const zone = await this.catalog.resolve(cfProviderId, hostname)
    if (!zone) throw new ApiError('cloudflared_zone_not_found', zoneMissingMessage(hostname), 422)
    return zone
  }
}

function zoneMissingMessage(hostname: string): string {
  return `No Cloudflare zone matches ${hostname}`
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
  const rawConfig = asRecord(config.config)
  const routes: TunnelRoute[] = []
  let catchAll = CATCH_ALL_SERVICE
  for (const rule of asRecordArray(rawConfig.ingress)) {
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
  const rest: Record<string, unknown> = { ...rawConfig }
  delete rest.ingress
  return {
    routes,
    catch_all: catchAll,
    version: Number(config.version ?? 0) || 0,
    // ingress 之外的 config 级字段同样需要回写（见 CONFIG_REST）
    [CONFIG_REST]: rest,
  }
}

/** repair 逐主机名结果 → 副作用摘要：有失败记失败，全跳过记跳过，其余记完成 */
function repairSideEffect(tunnelId: string, results: Array<Record<string, unknown>>): DnsSideEffect {
  const actionOf = (record: Record<string, unknown>) => String(record.action ?? '')
  const count = (...actions: string[]) => results.filter((record) => actions.includes(actionOf(record))).length
  const failed = count('failed')
  const skipped = count('skipped', 'not_found')
  const written = count('created', 'updated')
  const unchanged = count('unchanged')
  const status: DnsSideEffect['status'] = failed > 0 ? 'failed' : written + unchanged === 0 ? 'skipped' : 'completed'
  const parts: string[] = []
  if (written > 0) parts.push(`已同步 ${written} 条`)
  if (unchanged > 0) parts.push(`无需变更 ${unchanged} 条`)
  if (skipped > 0) parts.push(`跳过 ${skipped} 条`)
  if (failed > 0) parts.push(`失败 ${failed} 条`)
  return {
    status,
    message: parts.length > 0 ? parts.join('、') : '该隧道没有可修复的路由',
    details: [{ tunnel_id: tunnelId, hostnames: results }],
  }
}
