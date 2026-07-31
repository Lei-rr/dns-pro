import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { wrapProviderError } from '../../../lib/http/wrap-provider-error.js'
import { buildDnsSideEffects, fromDnsOperationResult, type DnsOperationResult } from '../../../lib/utils/side-effect-result.js'
import { CacheTtl, cloudflaredTunnelConfigCacheTag, withProviderCache } from '../../../lib/cache/provider-cache.js'
import { emitTunnelRouteMutated } from '../events.js'
import { CloudflareGateway } from '../../cloudflare/gateways/gateway.js'
import { parseCloudflareItemResponse } from '../../../lib/providers/cloudflare-response.js'
import { CloudflareZoneService } from '../../cloudflare/services/zone-service.js'
import { CloudflaredDnsService } from './dns-service.js'
import type { CloudflareProvider, CloudflaredProvider } from '../../provider/types.js'

export interface CloudflaredRoute {
  hostname: string
  service: string
  path: string
}

export class CloudflaredRouteService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly cfZones: CloudflareZoneService,
    private readonly dnsService: CloudflaredDnsService
  ) {}

  async getConfig(providerId: string, tunnelId: string, refresh = false): Promise<{ routes: CloudflaredRoute[]; catch_all: string; version: number }> {
    const cached = await withProviderCache<{ routes: CloudflaredRoute[]; catch_all: string; version: number }>({
      key: `cloudflared:tunnel_config:${providerId}:${tunnelId}`,
      tags: [cloudflaredTunnelConfigCacheTag(providerId, tunnelId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const [provider, accountId] = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)

        let response
        try {
          response = await gateway.get(`accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`)
        } catch (error) {
          throw wrapProviderError(
            'cloudflared_route_list_failed',
            'Cloudflare Tunnel route list failed',
            providerId,
            error,
            { tunnel_id: tunnelId },
          )
        }
        const result = this.presentConfig(parseCloudflareItemResponse(response).result)
        return result
      },
    })
    return cached.value
  }

  async addRoute(providerId: string, tunnelId: string, route: CloudflaredRoute): Promise<Record<string, unknown>> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const normalized = this.normalizeRoute(route)
    const zoneId = await this.requireZoneId(cfProviderId, normalized.hostname)
    const current = await this.fetchRoutes(providerId, tunnelId)

    for (const existing of current) {
      if (this.isSameRouteKey(existing, normalized)) {
        throw new ApiError('cloudflared_route_exists', `Route ${normalized.hostname}${normalized.path} already exists`, 409)
      }
    }

    const newRoutes = [...current, normalized]
    await this.writeIngress(providerId, tunnelId, newRoutes)

    const dnsResult = await this.dnsService.safeEnsureCname(cfProviderId, zoneId, normalized.hostname, tunnelId)
    await emitTunnelRouteMutated({ providerId, tunnelId, hostname: String(route.hostname || ''), action: 'create' })

    return {
      hostname: normalized.hostname,
      service: normalized.service,
      path: normalized.path,
      side_effects: buildDnsSideEffects({ sync: fromDnsOperationResult(dnsResult, '已执行 Cloudflare DNS 同步') }),
    }
  }

  async updateRoute(providerId: string, tunnelId: string, originalHostname: string, originalPath: string, route: CloudflaredRoute): Promise<Record<string, unknown>> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const normalized = this.normalizeRoute(route)
    const zoneId = await this.requireZoneId(cfProviderId, normalized.hostname)
    const current = await this.fetchRoutes(providerId, tunnelId)

    let found = false
    const newRoutes: CloudflaredRoute[] = []
    for (const existing of current) {
      if (!found && existing.hostname === originalHostname.toLowerCase() && existing.path === originalPath) {
        newRoutes.push(normalized)
        found = true
      } else {
        newRoutes.push(existing)
      }
    }

    if (!found) {
      throw new ApiError('cloudflared_route_not_found', `Route ${originalHostname}${originalPath} not found`, 404)
    }

    const sameKeyCount = newRoutes.filter((r) => this.isSameRouteKey(r, normalized)).length
    if (sameKeyCount > 1) {
      throw new ApiError('cloudflared_route_exists', `Route ${normalized.hostname}${normalized.path} already exists`, 409)
    }

    await this.writeIngress(providerId, tunnelId, newRoutes)

    const hostnameChanged = originalHostname.toLowerCase() !== normalized.hostname
    if (hostnameChanged) {
      const stillUsed = newRoutes.filter((r) => r.hostname === originalHostname.toLowerCase())
      if (stillUsed.length === 0) {
        await this.dnsService.removeCnameBestEffort(cfProviderId, originalHostname, tunnelId)
      }
    }

    const dnsResult = await this.dnsService.safeEnsureCname(cfProviderId, zoneId, normalized.hostname, tunnelId)
    await emitTunnelRouteMutated({ providerId, tunnelId, hostname: String(route.hostname || originalHostname || ''), action: 'update' })

    return {
      hostname: normalized.hostname,
      service: normalized.service,
      path: normalized.path,
      side_effects: buildDnsSideEffects({ sync: fromDnsOperationResult(dnsResult, '已执行 Cloudflare DNS 同步') }),
    }
  }

  async deleteRoute(providerId: string, tunnelId: string, hostname: string, path: string): Promise<Record<string, unknown>> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const current = await this.fetchRoutes(providerId, tunnelId)
    const normalizedHostname = hostname.toLowerCase().trim()

    let found = false
    const newRoutes: CloudflaredRoute[] = []
    for (const existing of current) {
      if (!found && existing.hostname === normalizedHostname && existing.path === path) {
        found = true
        continue
      }
      newRoutes.push(existing)
    }

    if (!found) {
      throw new ApiError('cloudflared_route_not_found', `Route ${hostname}${path} not found`, 404)
    }

    await this.writeIngress(providerId, tunnelId, newRoutes)

    const stillUsed = newRoutes.filter((r) => r.hostname === normalizedHostname)
    let dnsResult: DnsOperationResult
    if (stillUsed.length > 0) {
      dnsResult = { action: 'kept', reason: 'hostname_still_used' }
    } else {
      dnsResult = await this.dnsService.safeRemoveCname(cfProviderId, '', normalizedHostname, tunnelId)
    }

    await emitTunnelRouteMutated({ providerId, tunnelId, hostname: String(hostname || ''), action: 'delete' })

    return {
      hostname: normalizedHostname,
      path,
      side_effects: buildDnsSideEffects({ cleanup: fromDnsOperationResult(dnsResult, '已执行 Cloudflare DNS 清理') }),
    }
  }

  private async fetchRoutes(providerId: string, tunnelId: string): Promise<CloudflaredRoute[]> {
    return (await this.getConfig(providerId, tunnelId, true)).routes
  }

  private async writeIngress(providerId: string, tunnelId: string, routes: CloudflaredRoute[]): Promise<void> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    try {
      await gateway.put(
        `accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
        this.buildIngress(routes),
      )
    } catch (error) {
      throw wrapProviderError(
        'cloudflared_route_write_failed',
        'Cloudflare Tunnel route update failed',
        providerId,
        error,
        { tunnel_id: tunnelId },
      )
    }
  }

  private normalizeRoute(route: CloudflaredRoute): CloudflaredRoute {
    const hostname = route.hostname.toLowerCase().trim().replace(/\.$/, '')
    const service = route.service.trim()
    const path = (route.path ?? '').trim()
    if (hostname === '' || service === '') {
      throw new ApiError('cloudflared_route_invalid', 'hostname and service are required', 422)
    }
    return { hostname, service, path }
  }

  private isSameRouteKey(a: CloudflaredRoute, b: CloudflaredRoute): boolean {
    return a.hostname === b.hostname && a.path === b.path
  }

  private buildIngress(routes: CloudflaredRoute[]): Record<string, unknown> {
    const ingress: Array<Record<string, unknown>> = routes.map((route) => {
      const entry: Record<string, unknown> = { hostname: route.hostname, service: route.service }
      if (route.path !== '') entry.path = route.path
      return entry
    })
    ingress.push({ service: 'http_status:404' })
    return { config: { ingress } }
  }

  private presentConfig(config: import('../../../lib/providers/cloudflare-response.js').CloudflareRouteConfig): { routes: CloudflaredRoute[]; catch_all: string; version: number } {
    const configData = config.config && typeof config.config === 'object' && !Array.isArray(config.config)
      ? config.config as Record<string, unknown>
      : {}
    const ingress = Array.isArray(configData.ingress) ? configData.ingress : []
    const routes: CloudflaredRoute[] = []
    let catchAll = 'http_status:404'

    for (const value of ingress) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const rule = value as Record<string, unknown>
      if (!rule.hostname) {
        if (typeof rule.service === 'string') catchAll = rule.service
      } else {
        if (typeof rule.hostname !== 'string' || typeof rule.service !== 'string') continue
        routes.push({
          hostname: rule.hostname,
          service: rule.service,
          path: typeof rule.path === 'string' ? rule.path : '',
        })
      }
    }

    return { routes, catch_all: catchAll, version: Number(config.version ?? 0) || 0 }
  }

  private async requireZoneId(cfProviderId: string, hostname: string): Promise<string> {
    const zoneId = await this.cfZones.bestMatchId(cfProviderId, hostname)
    if (zoneId === '') {
      throw new ApiError('cloudflared_zone_not_found', `No Cloudflare zone matches ${hostname}`, 422)
    }
    return zoneId
  }

  private async requireProvider(providerId: string): Promise<[CloudflareProvider, string]> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const cfProvider = await this.providers.requireType<CloudflareProvider>(cfProviderId, 'cloudflare', 'Cloudflare provider not found', 'cloudflare_provider_not_found')
    const accountId = cfProvider.account_id.trim()
    if (accountId === '') {
      throw new ApiError('cloudflared_account_id_required', 'Cloudflare account_id is required for tunnel operations', 422)
    }
    return [cfProvider, accountId]
  }

  private async cfProviderIdOf(providerId: string): Promise<string> {
    const cloudflaredProvider = await this.providers.requireType<CloudflaredProvider>(
      providerId,
      'cloudflared',
      'Cloudflare Tunnel provider not found',
      'cloudflared_provider_not_found'
    )
    const cfProviderId = cloudflaredProvider.cloudflare_provider.trim()
    if (cfProviderId === '') {
      throw new ApiError('cloudflared_cloudflare_provider_missing', 'Cloudflare Tunnel provider is not linked to a Cloudflare provider', 422)
    }
    return cfProviderId
  }


  private gatewayFor(provider: CloudflareProvider): CloudflareGateway {
    return CloudflareGateway.forToken(provider.api_token)
  }

}
