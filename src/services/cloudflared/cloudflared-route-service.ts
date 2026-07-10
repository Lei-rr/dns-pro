import { ProviderRepository } from '../../repositories/provider-repository.js'
import { ApiError } from '../../support/api-error.js'
import { type SideEffects } from '../../support/side-effect-result.js'
import { globalCache } from '../../support/cache-service.js'
import { CloudflareGateway } from '../../gateways/cloudflare-gateway.js'
import { CloudflareZoneService } from '../cloudflare/cloudflare-zone-service.js'
import { CloudflareDnsRecordService } from '../cloudflare/cloudflare-dns-record-service.js'
import type { CloudflareProvider } from '../../types/provider.js'

const TTL_MS = 3 * 24 * 60 * 60 * 1000

export interface CloudflaredRoute {
  hostname: string
  service: string
  path: string
  zone_id?: string
}

export class CloudflaredRouteService {
  constructor(
    private readonly providers: ProviderRepository = new ProviderRepository(),
    private readonly cfZones: CloudflareZoneService = new CloudflareZoneService(),
    private readonly dns: CloudflareDnsRecordService = new CloudflareDnsRecordService()
  ) {}

  async getConfig(providerId: string, tunnelId: string, refresh = false): Promise<{ routes: CloudflaredRoute[]; catch_all: string; version: number }> {
    const cacheKey = `cloudflared:tunnel_config:${providerId}:${tunnelId}`
    if (!refresh) {
      const cached = globalCache.get<{ routes: CloudflaredRoute[]; catch_all: string; version: number }>(cacheKey)
      if (cached) return cached
    }

    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = new CloudflareGateway(provider.api_token)

    const response = await gateway.get<{ config?: { ingress?: Array<Record<string, unknown>> }; version?: number }>(
      `accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`
    )
    const result = this.presentConfig(response.result ?? {})
    globalCache.set(cacheKey, result, TTL_MS, [`cloudflared:tunnel_config:${providerId}:${tunnelId}`])
    return result
  }

  async addRoute(providerId: string, tunnelId: string, route: CloudflaredRoute): Promise<Record<string, unknown>> {
    const normalized = this.normalizeRoute(route)
    const current = await this.fetchRoutes(providerId, tunnelId)

    for (const existing of current) {
      if (this.isSameRouteKey(existing, normalized)) {
        throw new ApiError('cloudflared_route_exists', `Route ${normalized.hostname}${normalized.path} already exists`, 409)
      }
    }

    const newRoutes = [...current, normalized]
    await this.writeIngress(providerId, tunnelId, newRoutes)

    const cfProviderId = await this.cfProviderIdOf(providerId)
    const dnsResult = await this.safeEnsureCname(cfProviderId, normalized.zone_id ?? '', normalized.hostname, tunnelId)
    globalCache.invalidateTags([`cloudflared:tunnel_config:${providerId}:${tunnelId}`])

    return {
      hostname: normalized.hostname,
      service: normalized.service,
      path: normalized.path,
      side_effects: this.dnsSideEffects({ sync: this.normalizeDnsOperation(dnsResult, '已执行 Cloudflare DNS 同步') }),
    }
  }

  async updateRoute(providerId: string, tunnelId: string, originalHostname: string, originalPath: string, route: CloudflaredRoute): Promise<Record<string, unknown>> {
    const normalized = this.normalizeRoute(route)
    const cfProviderId = await this.cfProviderIdOf(providerId)
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
        await this.removeCnameBestEffort(cfProviderId, originalHostname, tunnelId)
      }
    }

    const dnsResult = await this.safeEnsureCname(cfProviderId, normalized.zone_id ?? '', normalized.hostname, tunnelId)
    globalCache.invalidateTags([`cloudflared:tunnel_config:${providerId}:${tunnelId}`])

    return {
      hostname: normalized.hostname,
      service: normalized.service,
      path: normalized.path,
      side_effects: this.dnsSideEffects({ sync: this.normalizeDnsOperation(dnsResult, '已执行 Cloudflare DNS 同步') }),
    }
  }

  async deleteRoute(providerId: string, tunnelId: string, hostname: string, path: string, zoneId: string): Promise<Record<string, unknown>> {
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
    let dnsResult: Record<string, unknown>
    if (stillUsed.length > 0) {
      dnsResult = { action: 'kept', reason: 'hostname_still_used' }
    } else {
      dnsResult = await this.safeRemoveCname(cfProviderId, zoneId, normalizedHostname, tunnelId)
    }

    globalCache.invalidateTags([`cloudflared:tunnel_config:${providerId}:${tunnelId}`])

    return {
      hostname: normalizedHostname,
      path,
      side_effects: this.dnsSideEffects({ cleanup: this.normalizeDnsOperation(dnsResult, '已执行 Cloudflare DNS 清理') }),
    }
  }

  async listZones(providerId: string, refresh = false): Promise<{ items: Array<Record<string, unknown>> }> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const result = await this.cfZones.list(cfProviderId, 1, 100, '', refresh)
    return { items: result.items as unknown as Array<Record<string, unknown>> }
  }

  buildServiceUrl(protocol: string, address: string): string {
    const p = protocol.toLowerCase().trim()
    const valid = ['http', 'https', 'tcp', 'ssh', 'rdp', 'smb']
    return `${valid.includes(p) ? p : 'http'}://${address.trim()}`
  }

  private async fetchRoutes(providerId: string, tunnelId: string): Promise<CloudflaredRoute[]> {
    return (await this.getConfig(providerId, tunnelId, true)).routes
  }

  private async writeIngress(providerId: string, tunnelId: string, routes: CloudflaredRoute[]): Promise<void> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = new CloudflareGateway(provider.api_token)

    await gateway.put<Record<string, unknown>>(
      `accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      this.buildIngress(routes)
    )
  }

  private normalizeRoute(route: CloudflaredRoute): CloudflaredRoute {
    const hostname = route.hostname.toLowerCase().trim()
    const service = route.service.trim()
    const zoneId = (route.zone_id ?? '').trim()
    const path = (route.path ?? '').trim()
    if (hostname === '' || service === '' || zoneId === '') {
      throw new ApiError('cloudflared_route_invalid', 'hostname, service and zone_id are required', 422)
    }
    return { hostname, service, zone_id: zoneId, path }
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

  private presentConfig(config: Record<string, unknown>): { routes: CloudflaredRoute[]; catch_all: string; version: number } {
    const ingress = (config.config as Record<string, unknown> | undefined)?.ingress as Array<Record<string, unknown>> | undefined
    const routes: CloudflaredRoute[] = []
    let catchAll = 'http_status:404'

    for (const rule of ingress ?? []) {
      if (!rule.hostname) {
        catchAll = String(rule.service ?? 'http_status:404')
      } else {
        routes.push({ hostname: String(rule.hostname), service: String(rule.service), path: String(rule.path ?? '') })
      }
    }

    return { routes, catch_all: catchAll, version: Number(config.version ?? 0) }
  }

  private async safeEnsureCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<Record<string, unknown>> {
    try {
      return await this.ensureCname(cfProviderId, zoneId, hostname, tunnelId)
    } catch (error) {
      return { action: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async safeRemoveCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<Record<string, unknown>> {
    try {
      const resolvedZoneId = zoneId !== '' ? zoneId : await this.resolveZoneId(cfProviderId, hostname)
      if (resolvedZoneId === '') return { action: 'skipped', reason: 'zone_not_found' }
      return await this.removeCname(cfProviderId, resolvedZoneId, hostname, tunnelId)
    } catch (error) {
      return { action: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async ensureCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<Record<string, unknown>> {
    const cnameTarget = `${tunnelId}.cfargotunnel.com`

    for (const record of await this.exactCnameMatches(cfProviderId, zoneId, hostname)) {
      if (String(record.name ?? '') !== hostname) continue
      if (String(record.type ?? '') === 'CNAME' && String(record.content ?? '') === cnameTarget) {
        return { action: 'unchanged', record_id: String(record.id ?? '') }
      }
      if (String(record.type ?? '') === 'CNAME') {
        const updated = await this.dns.update(cfProviderId, zoneId, String(record.id), {
          type: 'CNAME',
          name: hostname,
          content: cnameTarget,
          proxied: true,
          ttl: 1,
        })
        return { action: 'updated', record_id: String(updated.id ?? '') }
      }
    }

    const created = await this.dns.create(cfProviderId, zoneId, {
      type: 'CNAME',
      name: hostname,
      content: cnameTarget,
      proxied: true,
      ttl: 1,
    })
    return { action: 'created', record_id: String(created.id ?? '') }
  }

  private async removeCname(cfProviderId: string, zoneId: string, hostname: string, tunnelId: string): Promise<Record<string, unknown>> {
    const cnameTarget = `${tunnelId}.cfargotunnel.com`

    for (const record of await this.exactCnameMatches(cfProviderId, zoneId, hostname)) {
      if (String(record.name ?? '') === hostname && String(record.content ?? '') === cnameTarget) {
        await this.dns.delete(cfProviderId, zoneId, String(record.id))
        return { action: 'deleted', record_id: String(record.id) }
      }
    }

    return { action: 'not_found' }
  }

  private async removeCnameBestEffort(cfProviderId: string, hostname: string, tunnelId: string): Promise<void> {
    const normalized = hostname.toLowerCase().trim()
    const zoneId = await this.resolveZoneId(cfProviderId, normalized)
    if (zoneId === '') return
    try {
      await this.removeCname(cfProviderId, zoneId, normalized, tunnelId)
    } catch {
      // ignore
    }
  }

  private async exactCnameMatches(cfProviderId: string, zoneId: string, hostname: string): Promise<Array<Record<string, unknown>>> {
    const matches: Array<Record<string, unknown>> = []
    let page = 1
    let totalPages = 1

    do {
      const result = await this.dns.list(cfProviderId, zoneId, { type: 'CNAME', search: hostname, page, per_page: 100 })
      for (const record of result.items) {
        if (String(record.name ?? '') === hostname) {
          matches.push(record as unknown as Record<string, unknown>)
        }
      }
      totalPages = Number(result.pagination.total_pages ?? result.pagination.total_count ?? 1)
      page++
    } while (page <= totalPages)

    return matches
  }

  private async resolveZoneId(cfProviderId: string, fqdn: string): Promise<string> {
    const normalized = fqdn.replace(/\.$/, '').trim().toLowerCase()
    if (normalized === '') return ''

    const zones = await this.allZones(cfProviderId)
    let bestName = ''
    let bestId = ''

    for (const zone of zones) {
      const name = String(zone.name ?? '').toLowerCase()
      const id = String(zone.id ?? '')
      if (name === '' || id === '') continue
      if ((normalized === name || normalized.endsWith('.' + name)) && name.length > bestName.length) {
        bestName = name
        bestId = id
      }
    }

    return bestId
  }

  private async allZones(cfProviderId: string): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = []
    let page = 1
    let totalPages = 1

    do {
      const result = await this.cfZones.list(cfProviderId, page, 100, '', page === 1)
      items.push(...(result.items as unknown as Array<Record<string, unknown>>))
      totalPages = Number(result.pagination.total_pages ?? result.pagination.total_count ?? 1)
      page++
    } while (page <= totalPages)

    return items
  }

  private async requireProvider(providerId: string): Promise<[CloudflareProvider, string]> {
    const cfProviderId = await this.cfProviderIdOf(providerId)
    const cfProvider = (await this.providers.requireType(cfProviderId, 'cloudflare', 'Cloudflare provider not found', 'cloudflare_provider_not_found')) as unknown as CloudflareProvider
    const accountId = cfProvider.account_id.trim()
    if (accountId === '') {
      throw new ApiError('cloudflared_account_id_required', 'Cloudflare account_id is required for tunnel operations', 422)
    }
    return [cfProvider, accountId]
  }

  private async cfProviderIdOf(providerId: string): Promise<string> {
    const cloudflaredProvider = await this.providers.requireType(
      providerId,
      'cloudflared',
      'Cloudflare Tunnel provider not found',
      'cloudflared_provider_not_found'
    )
    const cfProviderId = String((cloudflaredProvider as unknown as Record<string, unknown>).cloudflare_provider ?? '').trim()
    if (cfProviderId === '') {
      throw new ApiError('cloudflared_cloudflare_provider_missing', 'Cloudflare Tunnel provider is not linked to a Cloudflare provider', 422)
    }
    return cfProviderId
  }

  private normalizeDnsOperation(result: Record<string, unknown>, defaultMessage: string): Record<string, unknown> {
    const action = String(result.action ?? 'unknown')
    const status = action === 'failed' ? 'failed' : ['skipped', 'kept', 'not_found'].includes(action) ? 'skipped' : 'completed'
    return { status, message: String(result.message ?? result.error ?? defaultMessage), details: [result] }
  }

  private dnsSideEffects(effects: { sync?: Record<string, unknown>; cleanup?: Record<string, unknown> }): SideEffects {
    const sideEffects: SideEffects = { dns: {} }
    if (effects.sync) sideEffects.dns!.sync = effects.sync as never
    if (effects.cleanup) sideEffects.dns!.cleanup = effects.cleanup as never
    return sideEffects
  }
}
