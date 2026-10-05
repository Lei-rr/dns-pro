import { ApiError } from '../../core/http/api-error.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import type { CloudflareProvider, CloudflaredProvider } from '../../core/providers/provider.types.js'
import { CloudflareClient } from './cloudflare.client.js'

export type TunnelAccount = CloudflareAccount & { cloudflareProviderId: string }

interface CloudflareAccount {
  provider: CloudflareProvider
  accountId: string
  client: CloudflareClient
}

/**
 * account_id 在 provider-definitions 中不是必填字段（只有 api_token 必填），
 * 历史或手工写入的 providers.json 行可能没有它：按「可能缺失」读取，避免直接 .trim() 抛 TypeError。
 */
export function providerAccountId(provider: CloudflareProvider): string {
  return String(provider.account_id ?? '').trim()
}

/**
 * D2 底座：provider → 账号 → 客户端 的唯一定义。
 * DNS / SaaS / 隧道三条产品线只依赖本类，不互相引用。
 */
export class CloudflareAccess {
  constructor(
    private readonly providers: ProviderRepository,
    /** 上游超时：装配层构造传入（D7 消除模块级全局 setter） */
    private readonly httpTimeoutMs?: number
  ) {}

  /** 解析 Cloudflare 服务商的账号与客户端 */
  async forProvider(providerId: string): Promise<CloudflareAccount> {
    const provider = await this.providers.requireType(
      providerId,
      'cloudflare',
      'Cloudflare provider not found',
      'cloudflare_provider_not_found'
    )
    return {
      provider,
      accountId: providerAccountId(provider),
      client: CloudflareClient.forProvider(provider, this.httpTimeoutMs),
    }
  }

  /** 隧道服务商 → 其关联的 Cloudflare 服务商 ID */
  async linkedProviderId(providerId: string): Promise<string> {
    // 显式标注：本模块消费的正是 cloudflared 行的形状，判别键映射变化会在这里暴露
    const tunnelProvider: CloudflaredProvider = await this.providers.requireType(
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

  /** 隧道服务商 → 关联账号（要求 Cloudflare 已配置 account_id） */
  async forTunnel(providerId: string): Promise<TunnelAccount> {
    const cloudflareProviderId = await this.linkedProviderId(providerId)
    const account = await this.forProvider(cloudflareProviderId)
    if (account.accountId === '') {
      throw new ApiError(
        'cloudflared_account_id_required',
        'Cloudflare account_id is required for tunnel operations',
        422
      )
    }
    return { ...account, cloudflareProviderId }
  }
}
