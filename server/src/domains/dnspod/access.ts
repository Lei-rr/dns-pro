import { ApiError } from '../../kernel/http/api-error.js'
import type { ProviderRepository } from '../../kernel/providers/provider.repository.js'
import type { EdgeOneProvider, ProviderType, SaaSProvider } from '../../kernel/providers/provider.types.js'

/** 关联 DNSPod 的来源：EdgeOne 与 SaaS 各有一个 dnspod_provider 字段 */
export type DnsPodLinkSource = 'edgeone' | 'saas'

/**
 * D3-2 底座：provider → 关联 DNSPod 账号 的唯一定义。
 * EdgeOne / SaaS 两条产品线只依赖本类，不各自实现关联解析。
 */
export class DnsPodAccess {
  constructor(private readonly providers: ProviderRepository) {}

  /** 读取关联的 DNSPod 服务商 ID；未关联返回空串 */
  async linkedProviderId(providerId: string, source: DnsPodLinkSource, label: string): Promise<string> {
    const provider = await this.providers.requireType(
      providerId,
      source as ProviderType,
      `${label} provider not found`,
      `${source}_provider_not_found`
    )
    if (provider.type === 'edgeone') return (provider as EdgeOneProvider).dnspod_provider.trim()
    if (provider.type === 'saas') return ((provider as SaaSProvider).dnspod_provider ?? '').trim()
    return ''
  }

  /** 要求已关联，否则 422 */
  async requireLinkedProviderId(providerId: string, source: DnsPodLinkSource, label: string): Promise<string> {
    const id = await this.linkedProviderId(providerId, source, label)
    if (id === '') {
      throw new ApiError(
        `${source}_dnspod_provider_missing`,
        `${label} provider is not linked to a DNSPod provider`,
        422
      )
    }
    return id
  }
}
