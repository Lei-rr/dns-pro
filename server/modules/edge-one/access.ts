import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import type { EdgeOneProvider } from '../../core/providers/provider.types.js'
import { DnsPodAccess } from '../dnspod/access.js'
import { EdgeOneClient } from './edge-one.client.js'

/** EdgeOne 服务商及其关联 DNSPod（提供腾讯云密钥） */
export async function resolveEdgeOneProvider(
  providers: ProviderRepository,
  edgeoneProviderId: string
): Promise<{ provider: EdgeOneProvider; dnspodProviderId: string }> {
  const provider = await providers.requireType(
    edgeoneProviderId,
    'edgeone',
    'EdgeOne provider not found',
    'edgeone_provider_not_found'
  )
  // 字段可能缺失（旧数据/手工编辑）：未关联时返回空串——缓存标签可接受空值，
  // 需要腾讯云密钥的路径由 edgeOneClientFor 经 DnsPodAccess 统一拒绝
  return { provider, dnspodProviderId: String(provider.dnspod_provider ?? '').trim() }
}

/** 每次调用都从持久化配置读取关联 DNSPod 密钥并创建客户端 */
export async function edgeOneClientFor(
  providers: ProviderRepository,
  edgeoneProviderId: string,
  timeoutMs?: number
): Promise<EdgeOneClient> {
  // 「未关联 DNSPod」的错误码与文案只有一份：复用 D3-2 底座的 requireLinkedProviderId，
  // 不在这里另抛一个码，否则同一条件的两个错误码会把用户引向不同的排查方向
  const access = new DnsPodAccess(providers)
  const dnspodProviderId = await access.requireLinkedProviderId(edgeoneProviderId, 'edgeone', 'EdgeOne')
  const dnspod = await providers.requireType(
    dnspodProviderId,
    'dnspod',
    'DNSPod provider not found',
    'dnspod_provider_not_found'
  )
  return EdgeOneClient.forProvider(dnspod, timeoutMs)
}
