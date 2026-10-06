import { ApiError } from '../../core/http/api-error.js'
import type { LinkedDnsAccountPort, LinkedDnsAccountSource } from '../../core/contracts/linked-dns-account.port.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'

/** 关联 DNSPod 的来源：EdgeOne 与 SaaS 各有一个 dnspod_provider 字段（取值即端口层的关联来源） */
export type DnsPodLinkSource = LinkedDnsAccountSource

/**
 * D3-2 底座：provider → 关联 DNSPod 账号 的解析（`LinkedDnsAccountPort` 实现）。
 * EdgeOne / SaaS 两条产品线的编排只依赖本类；edge-one 模块在构造腾讯云客户端前
 * 也复用本类的 requireLinkedProviderId——「未关联 DNSPod」的错误码与文案因此只有一份。
 */
export class DnsPodAccess implements LinkedDnsAccountPort {
  constructor(private readonly providers: ProviderRepository) {}

  /** 读取关联的 DNSPod 服务商 ID；未关联返回空串 */
  async linkedProviderId(providerId: string, source: DnsPodLinkSource, label: string): Promise<string> {
    const message = `${label} provider not found`
    const code = `${source}_provider_not_found`
    if (source === 'edgeone') {
      const provider = await this.providers.requireType(providerId, 'edgeone', message, code)
      return String(provider.dnspod_provider ?? '').trim()
    }
    const provider = await this.providers.requireType(providerId, 'saas', message, code)
    return String(provider.dnspod_provider ?? '').trim()
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
