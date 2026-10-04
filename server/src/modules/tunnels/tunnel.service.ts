import crypto from 'node:crypto'
import type { ProviderRepository } from '../providers/provider.repository.js'
import { cloudflaredTunnelsCacheTag, providerCacheTag, withProviderCache } from '../../platform/cache/provider-cache.js'
import { ApiError } from '../../shared/http/api-error.js'
import { errorMessage, parseBool } from '../../shared/lib/values.js'
import { isExplicitNotFound } from '../../shared/providers/provider-error.js'
import { callProvider, collectNumberedPages, wrapProviderError } from '../../shared/providers/provider-call.js'
import { providerOptionalString, providerString } from '../../shared/providers/provider-values.js'
import { asRecord, asRecordArray } from '../../shared/providers/response-guards.js'
import type { SideEffects } from '../../shared/providers/side-effect-result.js'
import {
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
  type CloudflareTunnel as RawTunnel,
} from '../cloudflare/cloudflare-response.schema.js'
import { invalidateTunnelListCache, invalidateTunnelRouteCache } from './tunnel.cache.js'
import { resolveTunnelAccount, tunnelPath, type TunnelAccount } from './tunnel-account.js'

interface CloudflaredTunnel {
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

const newTunnelSecret = () => crypto.randomBytes(32).toString('base64')

/** Cloudflare Tunnel 生命周期与令牌管理 */
export class TunnelService {
  constructor(private readonly providers: ProviderRepository) {}

  async list(providerId: string, refresh = false): Promise<{ items: CloudflaredTunnel[] }> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    const cached = await withProviderCache<{ items: CloudflaredTunnel[] }>({
      key: `cloudflared:tunnels:${providerId}`,
      tags: [
        providerCacheTag(providerId),
        providerCacheTag(account.cloudflare.id),
        cloudflaredTunnelsCacheTag(providerId),
      ],
      refresh,
      loader: async () => ({
        items: await collectNumberedPages(
          async (page, perPage) => {
            const response = await callProvider(
              { code: 'cloudflared_tunnel_list_failed', message: 'Cloudflare Tunnel list failed', providerId },
              () => account.client.get(tunnelPath(account.accountId), { is_deleted: 'false', page, per_page: perPage })
            )
            return parseCloudflareListResponse(response, presentTunnel)
          },
          { limitCode: 'cloudflared_pagination_limit', limitMessage: 'Cloudflare Tunnel pagination limit reached' }
        ),
      }),
    })
    return cached.value
  }

  async show(providerId: string, tunnelId: string, refresh = false): Promise<CloudflaredTunnel> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    const cached = await withProviderCache<CloudflaredTunnel>({
      key: `cloudflared:tunnel:${providerId}:${tunnelId}`,
      tags: [
        providerCacheTag(providerId),
        providerCacheTag(account.cloudflare.id),
        cloudflaredTunnelsCacheTag(providerId),
      ],
      refresh,
      loader: async () => {
        const response = await callProvider(
          {
            code: 'cloudflared_tunnel_show_failed',
            message: 'Cloudflare Tunnel show failed',
            providerId,
            details: { tunnel_id: tunnelId },
          },
          () => account.client.get(tunnelPath(account.accountId, tunnelId))
        )
        return presentTunnel(parseCloudflareItemResponse(response).result)
      },
    })
    return cached.value
  }

  /** 创建隧道并获取令牌；令牌获取失败不回滚，作为副作用返回 */
  async create(
    providerId: string,
    name: string
  ): Promise<{ tunnel: CloudflaredTunnel; token: string | null; side_effects?: SideEffects }> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    const response = await callProvider(
      { code: 'cloudflared_tunnel_create_failed', message: 'Cloudflare Tunnel create failed', providerId },
      () =>
        account.client.post(tunnelPath(account.accountId), {
          name: name.trim(),
          config_src: 'cloudflare',
          tunnel_secret: newTunnelSecret(),
        })
    )
    const tunnel = presentTunnel(parseCloudflareItemResponse(response).result)
    invalidateTunnelListCache(providerId)
    try {
      return { tunnel, token: await this.fetchToken(account, tunnel.id) }
    } catch (error) {
      return {
        tunnel,
        token: null,
        side_effects: {
          tunnel: { token: { status: 'failed', message: errorMessage(error), details: [{ tunnel_id: tunnel.id }] } },
        },
      }
    }
  }

  /** 先断开连接再删除；连接不存在视为已断开 */
  async delete(providerId: string, tunnelId: string): Promise<{ id: string }> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    const path = tunnelPath(account.accountId, tunnelId)
    try {
      await account.client.delete(`${path}/connections`)
    } catch (error) {
      if (!isExplicitNotFound(error)) {
        throw wrapProviderError(
          'cloudflared_tunnel_connections_delete_failed',
          'Cloudflare Tunnel connections delete failed',
          providerId,
          error,
          { tunnel_id: tunnelId }
        )
      }
    }
    await callProvider(
      {
        code: 'cloudflared_tunnel_delete_failed',
        message: 'Cloudflare Tunnel delete failed',
        providerId,
        details: { tunnel_id: tunnelId },
      },
      () => account.client.delete(path)
    )
    invalidateTunnelListCache(providerId)
    // 隧道已删除：其路由配置缓存必须一并失效，否则仍会返回旧配置
    invalidateTunnelRouteCache(providerId, tunnelId)
    return { id: tunnelId }
  }

  async token(providerId: string, tunnelId: string): Promise<{ token: string }> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    return { token: await this.fetchToken(account, tunnelId) }
  }

  /** 轮换隧道密钥后返回新令牌 */
  async rotateToken(providerId: string, tunnelId: string): Promise<{ token: string }> {
    const account = await resolveTunnelAccount(this.providers, providerId)
    await callProvider(
      {
        code: 'cloudflared_tunnel_token_rotate_failed',
        message: 'Cloudflare Tunnel token rotate failed',
        providerId,
        details: { tunnel_id: tunnelId },
      },
      () => account.client.patch(tunnelPath(account.accountId, tunnelId), { tunnel_secret: newTunnelSecret() })
    )
    invalidateTunnelListCache(providerId)
    return { token: await this.fetchToken(account, tunnelId) }
  }

  private async fetchToken(account: TunnelAccount, tunnelId: string): Promise<string> {
    const response = await callProvider(
      {
        code: 'cloudflared_tunnel_token_failed',
        message: 'Cloudflare Tunnel token fetch failed',
        providerId: account.cloudflare.id,
        details: { tunnel_id: tunnelId },
      },
      () => account.client.get(`${tunnelPath(account.accountId, tunnelId)}/token`)
    )
    const result = response.result
    if (typeof result === 'string' && result !== '') return result
    const token = asRecord(result).token
    if (typeof token === 'string' && token !== '') return token
    throw new ApiError('cloudflared_tunnel_token_invalid', 'Cloudflare Tunnel returned an invalid token', 502)
  }
}

function presentTunnel(tunnel: RawTunnel): CloudflaredTunnel {
  return {
    id: providerString(tunnel.id),
    name: providerString(tunnel.name),
    status: providerString(tunnel.status, 'inactive'),
    config_src: providerOptionalString(tunnel.config_src),
    remote_config: parseBool(tunnel.remote_config ?? false),
    connections: asRecordArray(tunnel.connections).map((conn) => ({
      id: providerOptionalString(conn.id),
      client_id: providerOptionalString(conn.client_id),
      client_version: providerOptionalString(conn.client_version),
      colo_name: providerOptionalString(conn.colo_name),
      is_pending_reconnect: parseBool(conn.is_pending_reconnect ?? false),
      opened_at: providerOptionalString(conn.opened_at),
      origin_ip: providerOptionalString(conn.origin_ip),
    })),
    conns_active_at: providerOptionalString(tunnel.conns_active_at),
    conns_inactive_at: providerOptionalString(tunnel.conns_inactive_at),
    created_at: providerOptionalString(tunnel.created_at),
  }
}
