import { ApiError } from '../../core/http/api-error.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import type { EdgeOneProvider, SaaSProvider } from '../../core/providers/provider.types.js'

/** 关联 DNSPod 的来源：EdgeOne 与 SaaS 各有一个 dnspod_provider 字段 */
export type DnsPodLinkSource = 'edgeone' | 'saas'

/**
 * D3-2 底座：provider → 关联 DNSPod 账号 的解析。
 * EdgeOne / SaaS 两条产品线只依赖本类；edgeone 模块不得反向引用本模块，
 * 故 edge-one-credentials.ts 内保留一份等效实现（错误码与归一方式与其保持一致）。
 */
export class DnsPodAccess {
  constructor(private readonly providers: ProviderRepository) {}

  /** 读取关联的 DNSPod 服务商 ID；未关联返回空串 */
  async linkedProviderId(providerId: string, source: DnsPodLinkSource, label: string): Promise<string> {
    const message = `${label} provider not found`
    const code = `${source}_provider_not_found`
    if (source === 'edgeone') {
      const provider = await this.providers.requireType<EdgeOneProvider>(providerId, 'edgeone', message, code)
      return String(provider.dnspod_provider ?? '').trim()
    }
    const provider = await this.providers.requireType<SaaSProvider>(providerId, 'saas', message, code)
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
