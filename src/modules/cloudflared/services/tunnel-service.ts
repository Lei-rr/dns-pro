import crypto from 'node:crypto'
import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { CacheTtl, globalCache, invalidateProviderCache } from '../../../lib/cache/provider-cache.js'
import { CloudflareGateway } from '../../cloudflare/gateways/gateway.js'
import {
  cloudflareTunnelSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../../../lib/providers/cloudflare-response.js'
import type { CloudflareProvider, CloudflaredProvider } from '../../provider/types.js'

export interface CloudflaredTunnel {
  id: string
  name: string
  status: string
  config_src?: string
  remote_config?: boolean
  connections: Array<Record<string, unknown>>
  conns_active_at?: string
  conns_inactive_at?: string
  created_at?: string
}

export class CloudflaredTunnelService {
  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async list(providerId: string, refresh = false): Promise<{ items: CloudflaredTunnel[] }> {
    const cacheKey = `cloudflared:tunnels:${providerId}`
    if (!refresh) {
      const cached = globalCache.get<{ items: CloudflaredTunnel[] }>(cacheKey)
      if (cached) return cached
    }

    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = new CloudflareGateway(provider.api_token)

    const items: CloudflaredTunnel[] = []
    let page = 1
    let hasMore = true
    while (hasMore) {
      const response = await gateway.get(`accounts/${accountId}/cfd_tunnel`, {
        is_deleted: 'false',
        page,
        per_page: 100,
      })
      const batch = parseCloudflareListResponse(response, cloudflareTunnelSchema).result
      for (const tunnel of batch) {
        items.push(this.presentTunnel(tunnel))
      }
      hasMore = batch.length >= 100
      page++
    }

    const result = { items }
    globalCache.set(cacheKey, result, CacheTtl.providerData, [`cloudflared:tunnels:${providerId}`])
    return result
  }

  async show(providerId: string, tunnelId: string, refresh = false): Promise<CloudflaredTunnel> {
    const cacheKey = `cloudflared:tunnel:${providerId}:${tunnelId}`
    if (!refresh) {
      const cached = globalCache.get<CloudflaredTunnel>(cacheKey)
      if (cached) return cached
    }

    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = new CloudflareGateway(provider.api_token)

    const response = await gateway.get(`accounts/${accountId}/cfd_tunnel/${tunnelId}`)
    const result = this.presentTunnel(parseCloudflareItemResponse(response, cloudflareTunnelSchema).result)
    globalCache.set(cacheKey, result, CacheTtl.providerData, [`cloudflared:tunnels:${providerId}`])
    return result
  }

  async create(providerId: string, name: string): Promise<{ tunnel: CloudflaredTunnel; token: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = new CloudflareGateway(provider.api_token)

    const response = await gateway.post(`accounts/${accountId}/cfd_tunnel`, {
      name: name.trim(),
      config_src: 'cloudflare',
      tunnel_secret: crypto.randomBytes(32).toString('base64'),
    })

    await invalidateProviderCache([`cloudflared:tunnels:${providerId}`])
    const tunnel = this.presentTunnel(parseCloudflareItemResponse(response, cloudflareTunnelSchema).result)
    const token = await this.fetchToken(provider, accountId, tunnel.id)
    return { tunnel, token }
  }

  async delete(providerId: string, tunnelId: string): Promise<{ id: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = new CloudflareGateway(provider.api_token)

    try {
      await gateway.delete(`accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`)
    } catch (error) {
      if (!(error instanceof ApiError && error.statusCode === 404)) throw error
    }

    await gateway.delete(`accounts/${accountId}/cfd_tunnel/${tunnelId}`)
    await invalidateProviderCache([`cloudflared:tunnels:${providerId}`])
    return { id: tunnelId }
  }

  async token(providerId: string, tunnelId: string): Promise<{ token: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const token = await this.fetchToken(provider, accountId, tunnelId)
    return { token }
  }

  async rotateToken(providerId: string, tunnelId: string): Promise<{ token: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = new CloudflareGateway(provider.api_token)

    await gateway.patch(`accounts/${accountId}/cfd_tunnel/${tunnelId}`, {
      tunnel_secret: crypto.randomBytes(32).toString('base64'),
    })

    await invalidateProviderCache([`cloudflared:tunnels:${providerId}`])
    const token = await this.fetchToken(provider, accountId, tunnelId)
    return { token }
  }

  private async requireProvider(providerId: string): Promise<[CloudflareProvider, string]> {
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

    const cfProvider = await this.providers.requireType<CloudflareProvider>(cfProviderId, 'cloudflare', 'Cloudflare provider not found', 'cloudflare_provider_not_found')
    const accountId = cfProvider.account_id.trim()
    if (accountId === '') {
      throw new ApiError('cloudflared_account_id_required', 'Cloudflare account_id is required for tunnel operations', 422)
    }

    return [cfProvider, accountId]
  }

  private async fetchToken(provider: CloudflareProvider, accountId: string, tunnelId: string): Promise<string> {
    const gateway = new CloudflareGateway(provider.api_token)
    const response = await gateway.get(`accounts/${accountId}/cfd_tunnel/${tunnelId}/token`)
    const result = (response as any)?.result
    if (typeof result === 'string') return result
    if (result && typeof result === 'object' && typeof result.token === 'string') return result.token
    return String(result ?? '')
  }

  private presentTunnel(tunnel: import('../../../lib/providers/cloudflare-response.js').CloudflareTunnel): CloudflaredTunnel {
    return {
      id: tunnel.id ?? '',
      name: tunnel.name ?? '',
      status: tunnel.status ?? 'inactive',
      config_src: tunnel.config_src ?? undefined,
      remote_config: tunnel.remote_config ?? false,
      connections: (tunnel.connections ?? []).map((conn: Record<string, unknown>) => this.presentConnection(conn)),
      conns_active_at: tunnel.conns_active_at ?? undefined,
      conns_inactive_at: tunnel.conns_inactive_at ?? undefined,
      created_at: tunnel.created_at ?? undefined,
    }
  }

  private presentConnection(conn: Record<string, unknown>): Record<string, unknown> {
    return {
      id: conn.id,
      client_id: conn.client_id,
      client_version: conn.client_version,
      colo_name: conn.colo_name,
      is_pending_reconnect: Boolean(conn.is_pending_reconnect ?? false),
      opened_at: conn.opened_at,
      origin_ip: conn.origin_ip,
    }
  }

}
