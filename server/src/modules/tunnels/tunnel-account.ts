import { ApiError } from '../../shared/http/api-error.js'
import { CloudflareClient } from '../cloudflare/cloudflare.client.js'
import type { ProviderRepository } from '../providers/provider.repository.js'
import type { CloudflareProvider, CloudflaredProvider } from '../providers/provider.types.js'

export interface TunnelAccount {
  /** 关联的 Cloudflare 服务商 */
  cloudflare: CloudflareProvider
  accountId: string
  client: CloudflareClient
}

/** Tunnel 服务商 → 关联 Cloudflare 服务商 ID */
export async function linkedCloudflareProviderId(providers: ProviderRepository, providerId: string): Promise<string> {
  const tunnelProvider = await providers.requireType<CloudflaredProvider>(
    providerId,
    'cloudflared',
    'Cloudflare Tunnel provider not found',
    'cloudflared_provider_not_found'
  )
  const cloudflareProviderId = tunnelProvider.cloudflare_provider.trim()
  if (cloudflareProviderId === '') {
    throw new ApiError(
      'cloudflared_cloudflare_provider_missing',
      'Cloudflare Tunnel provider is not linked to a Cloudflare provider',
      422
    )
  }
  return cloudflareProviderId
}

/** 解析隧道操作所需的账号与客户端（要求 Cloudflare 配置了 account_id） */
export async function resolveTunnelAccount(providers: ProviderRepository, providerId: string): Promise<TunnelAccount> {
  const cloudflare = await providers.requireType<CloudflareProvider>(
    await linkedCloudflareProviderId(providers, providerId),
    'cloudflare',
    'Cloudflare provider not found',
    'cloudflare_provider_not_found'
  )
  const accountId = cloudflare.account_id.trim()
  if (accountId === '') {
    throw new ApiError(
      'cloudflared_account_id_required',
      'Cloudflare account_id is required for tunnel operations',
      422
    )
  }
  return { cloudflare, accountId, client: CloudflareClient.forProvider(cloudflare) }
}

export function tunnelPath(accountId: string, tunnelId = ''): string {
  const base = `accounts/${encodeURIComponent(accountId)}/cfd_tunnel`
  return tunnelId ? `${base}/${encodeURIComponent(tunnelId)}` : base
}
