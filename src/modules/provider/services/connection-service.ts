import { ApiError } from '../../../lib/http/api-error.js'
import type { ProviderRepository } from '../repository.js'
import type { ProviderType } from '../types.js'

export type ProviderConnectionResult = {
  ok: true
  type: string
  message: string
  details?: Record<string, unknown>
}

type ProviderProbes = {
  dnspodZones: {
    list(providerId: string, options: { offset: number; limit: number; refresh: boolean }): Promise<{
      items: unknown[]
      pagination?: { total?: number | null }
    }>
  }
  cloudflareZones: {
    list(providerId: string, page: number, perPage: number, name: string, refresh: boolean): Promise<{
      items: unknown[]
      pagination?: { total_count?: number | null }
    }>
  }
  edgeoneZones: { zones(providerId: string, refresh: boolean): Promise<{ items: unknown[] }> }
  cloudflaredTunnels: { list(providerId: string, refresh: boolean): Promise<{ items: unknown[] }> }
}

/** Vendor-specific connectivity probes, separate from provider persistence/CRUD. */
export class ProviderConnectionService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly probes: ProviderProbes,
  ) {}

  async test(id: string, visited: ReadonlySet<string> = new Set()): Promise<ProviderConnectionResult> {
    if (visited.has(id)) {
      throw new ApiError('provider_reference_cycle', `Provider reference cycle detected at ${id}`, 422, {
        provider_id: id,
        chain: [...Array.from(visited), id],
      })
    }
    const provider = await this.providers.find(id)
    if (!provider) throw new ApiError('provider_not_found', 'Provider not found', 404)
    const nextVisited = new Set(visited).add(id)

    try {
      switch (provider.type) {
        case 'dnspod': {
          const zones = await this.probes.dnspodZones.list(provider.id, { offset: 0, limit: 1, refresh: true })
          const total = zones.pagination?.total ?? zones.items.length
          return { ok: true, type: provider.type, message: `DNSPod 连接正常（域名 ${total} 个）`, details: { total } }
        }
        case 'cloudflare': {
          const zones = await this.probes.cloudflareZones.list(provider.id, 1, 1, '', true)
          const total = zones.pagination?.total_count ?? zones.items.length
          return { ok: true, type: provider.type, message: `Cloudflare 连接正常（站点 ${total} 个）`, details: { total } }
        }
        case 'edgeone': {
          const linked = provider.dnspod_provider.trim()
          if (!linked) throw new ApiError('edgeone_dnspod_provider_not_found', 'EdgeOne 未关联 DNSPod', 422)
          await this.testLinked(linked, 'dnspod', nextVisited)
          const zones = await this.probes.edgeoneZones.zones(provider.id, true)
          return {
            ok: true,
            type: provider.type,
            message: `EdgeOne 连接正常（站点 ${zones.items.length} 个）`,
            details: { total: zones.items.length, dnspod_provider: linked },
          }
        }
        case 'saas': {
          const linked = provider.cloudflare_provider.trim()
          if (!linked) throw new ApiError('saas_cloudflare_provider_missing', 'SaaS 未关联 Cloudflare', 422)
          await this.testLinked(linked, 'cloudflare', nextVisited)
          return {
            ok: true,
            type: provider.type,
            message: 'SaaS 关联的 Cloudflare 连接正常',
            details: { cloudflare_provider: linked },
          }
        }
        case 'cloudflared': {
          const linked = provider.cloudflare_provider.trim()
          if (!linked) throw new ApiError('cloudflared_cloudflare_provider_missing', 'Tunnel 未关联 Cloudflare', 422)
          await this.testLinked(linked, 'cloudflare', nextVisited)
          const tunnels = await this.probes.cloudflaredTunnels.list(provider.id, true)
          return {
            ok: true,
            type: provider.type,
            message: `Cloudflare Tunnel 连接正常（隧道 ${tunnels.items.length} 个）`,
            details: { total: tunnels.items.length, cloudflare_provider: linked },
          }
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        'provider_test_failed',
        error instanceof Error ? error.message : String(error || 'Provider test failed'),
        502,
        { provider_id: id, type: provider.type },
      )
    }
  }

  private async testLinked(
    id: string,
    expectedType: ProviderType,
    visited: ReadonlySet<string>,
  ): Promise<ProviderConnectionResult> {
    const provider = await this.providers.find(id)
    if (!provider) {
      throw new ApiError('provider_reference_not_found', `Linked provider ${id} not found`, 422, {
        provider_id: id,
        expected_type: expectedType,
      })
    }
    if (provider.type !== expectedType) {
      throw new ApiError(
        'provider_reference_type_mismatch',
        `Linked provider ${id} must be ${expectedType}, got ${provider.type}`,
        422,
        { provider_id: id, expected_type: expectedType, actual_type: provider.type },
      )
    }
    return this.test(id, visited)
  }
}
