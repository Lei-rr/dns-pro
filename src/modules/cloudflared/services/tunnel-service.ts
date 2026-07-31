import crypto from 'node:crypto'
import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { wrapProviderError } from '../../../lib/http/wrap-provider-error.js'
import { CacheTtl, cloudflaredTunnelsCacheTag, withProviderCache } from '../../../lib/cache/provider-cache.js'
import { emitTunnelMutated } from '../events.js'
import { CloudflareGateway } from '../../cloudflare/gateways/gateway.js'
import {
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../../../lib/providers/cloudflare-response.js'
import type { CloudflareProvider, CloudflaredProvider } from '../../provider/types.js'
import { parseBool } from '../../../lib/utils/parse-bool.js'
import { providerOptionalString, providerString } from '../../../lib/providers/provider-values.js'

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
  constructor(private readonly providers: ProviderRepository) {}

  async list(providerId: string, refresh = false): Promise<{ items: CloudflaredTunnel[] }> {
    const cached = await withProviderCache<{ items: CloudflaredTunnel[] }>({
      key: `cloudflared:tunnels:${providerId}`,
      tags: [cloudflaredTunnelsCacheTag(providerId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const [provider, accountId] = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)

        const items: CloudflaredTunnel[] = []
        let page = 1
        let hasMore = true
        while (hasMore) {
          let response
          try {
            response = await gateway.get(`accounts/${accountId}/cfd_tunnel`, {
              is_deleted: 'false',
              page,
              per_page: 100,
            })
          } catch (error) {
            throw wrapProviderError('cloudflared_tunnel_list_failed', 'Cloudflare Tunnel list failed', providerId, error)
          }
          const parsed = parseCloudflareListResponse(response)
          const batch = parsed.result
          for (const tunnel of batch) {
            items.push(this.presentTunnel(tunnel))
          }
          hasMore = parsed.source_count >= 100
          if (hasMore && page >= 1000) throw new ApiError('cloudflared_pagination_limit', 'Cloudflare Tunnel pagination limit reached', 502)
          page++
        }

        const result = { items }
        return result
      },
    })
    return cached.value
  }

  async show(providerId: string, tunnelId: string, refresh = false): Promise<CloudflaredTunnel> {
    const cached = await withProviderCache<CloudflaredTunnel>({
      key: `cloudflared:tunnel:${providerId}:${tunnelId}`,
      tags: [cloudflaredTunnelsCacheTag(providerId)],
      ttlMs: CacheTtl.providerData,
      refresh,
      loader: async () => {
        const [provider, accountId] = await this.requireProvider(providerId)
        const gateway = this.gatewayFor(provider)

        let response
        try {
          response = await gateway.get(`accounts/${accountId}/cfd_tunnel/${tunnelId}`)
        } catch (error) {
          throw wrapProviderError('cloudflared_tunnel_show_failed', 'Cloudflare Tunnel show failed', providerId, error, {
            tunnel_id: tunnelId,
          })
        }
        const result = this.presentTunnel(parseCloudflareItemResponse(response).result)
        return result
      },
    })
    return cached.value
  }

  async create(providerId: string, name: string): Promise<{ tunnel: CloudflaredTunnel; token: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    let response
    try {
      response = await gateway.post(`accounts/${accountId}/cfd_tunnel`, {
        name: name.trim(),
        config_src: 'cloudflare',
        tunnel_secret: crypto.randomBytes(32).toString('base64'),
      })
    } catch (error) {
      throw wrapProviderError('cloudflared_tunnel_create_failed', 'Cloudflare Tunnel create failed', providerId, error)
    }

    const tunnel = this.presentTunnel(parseCloudflareItemResponse(response).result)
    await emitTunnelMutated({ providerId, action: 'create' })
    const token = await this.fetchToken(provider, accountId, tunnel.id)
    return { tunnel, token }
  }

  async delete(providerId: string, tunnelId: string): Promise<{ id: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    try {
      await gateway.delete(`accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`)
    } catch (error) {
      if (!(error instanceof ApiError && error.statusCode === 404)) {
        throw wrapProviderError(
          'cloudflared_tunnel_connections_delete_failed',
          'Cloudflare Tunnel connections delete failed',
          providerId,
          error,
          { tunnel_id: tunnelId },
        )
      }
    }

    try {
      await gateway.delete(`accounts/${accountId}/cfd_tunnel/${tunnelId}`)
    } catch (error) {
      throw wrapProviderError('cloudflared_tunnel_delete_failed', 'Cloudflare Tunnel delete failed', providerId, error, {
        tunnel_id: tunnelId,
      })
    }
    await emitTunnelMutated({ providerId, tunnelId, action: 'delete' })
    return { id: tunnelId }
  }

  async token(providerId: string, tunnelId: string): Promise<{ token: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const token = await this.fetchToken(provider, accountId, tunnelId)
    return { token }
  }

  async rotateToken(providerId: string, tunnelId: string): Promise<{ token: string }> {
    const [provider, accountId] = await this.requireProvider(providerId)
    const gateway = this.gatewayFor(provider)

    try {
      await gateway.patch(`accounts/${accountId}/cfd_tunnel/${tunnelId}`, {
        tunnel_secret: crypto.randomBytes(32).toString('base64'),
      })
    } catch (error) {
      throw wrapProviderError('cloudflared_tunnel_token_rotate_failed', 'Cloudflare Tunnel token rotate failed', providerId, error, {
        tunnel_id: tunnelId,
      })
    }

    await emitTunnelMutated({ providerId, tunnelId, action: 'token' })
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
    const gateway = this.gatewayFor(provider)
    let response
    try {
      response = await gateway.get(`accounts/${accountId}/cfd_tunnel/${tunnelId}/token`)
    } catch (error) {
      throw wrapProviderError(
        'cloudflared_tunnel_token_failed',
        'Cloudflare Tunnel token fetch failed',
        provider.id,
        error,
        { tunnel_id: tunnelId },
      )
    }
    const envelope = response && typeof response === 'object' && !Array.isArray(response)
      ? response as Record<string, unknown>
      : {}
    const result = envelope.result
    if (typeof result === 'string' && result !== '') return result
    if (result && typeof result === 'object') {
      const token = (result as Record<string, unknown>).token
      if (typeof token === 'string') return token
    }
    throw new ApiError('cloudflared_tunnel_token_invalid', 'Cloudflare Tunnel returned an invalid token', 502)
  }

  private presentTunnel(tunnel: import('../../../lib/providers/cloudflare-response.js').CloudflareTunnel): CloudflaredTunnel {
    return {
      id: providerString(tunnel.id),
      name: providerString(tunnel.name),
      status: providerString(tunnel.status, 'inactive'),
      config_src: providerOptionalString(tunnel.config_src),
      remote_config: parseBool(tunnel.remote_config ?? false),
      connections: Array.isArray(tunnel.connections)
        ? tunnel.connections
            .filter((conn): conn is Record<string, unknown> => Boolean(conn) && typeof conn === 'object' && !Array.isArray(conn))
            .map((conn) => this.presentConnection(conn))
        : [],
      conns_active_at: providerOptionalString(tunnel.conns_active_at),
      conns_inactive_at: providerOptionalString(tunnel.conns_inactive_at),
      created_at: providerOptionalString(tunnel.created_at),
    }
  }

  private presentConnection(value: unknown): Record<string, unknown> {
    const conn = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    return {
      id: providerOptionalString(conn.id),
      client_id: providerOptionalString(conn.client_id),
      client_version: providerOptionalString(conn.client_version),
      colo_name: providerOptionalString(conn.colo_name),
      is_pending_reconnect: parseBool(conn.is_pending_reconnect ?? false),
      opened_at: providerOptionalString(conn.opened_at),
      origin_ip: providerOptionalString(conn.origin_ip),
    }
  }


  private gatewayFor(provider: CloudflareProvider): CloudflareGateway {
    return CloudflareGateway.forToken(provider.api_token)
  }

}
