import { ApiError } from '../../core/http/api-error.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import type { DnsPodProvider, EdgeOneProvider } from '../../core/providers/provider.types.js'
import { EdgeOneClient } from './edge-one.client.js'

/** EdgeOne 服务商及其关联 DNSPod（提供腾讯云密钥） */
export async function resolveEdgeOneProvider(
  providers: ProviderRepository,
  edgeoneProviderId: string
): Promise<{ provider: EdgeOneProvider; dnspodProviderId: string }> {
  const provider = await providers.requireType<EdgeOneProvider>(
    edgeoneProviderId,
    'edgeone',
    'EdgeOne provider not found',
    'edgeone_provider_not_found'
  )
  // 字段可能缺失（旧数据/手工编辑）：未关联时返回空串，由调用方给出可读的 422
  return { provider, dnspodProviderId: String(provider.dnspod_provider ?? '').trim() }
}

/** 每次调用都从持久化配置读取关联 DNSPod 密钥并创建客户端 */
export async function edgeOneClientFor(
  providers: ProviderRepository,
  edgeoneProviderId: string,
  timeoutMs?: number
): Promise<EdgeOneClient> {
  const { dnspodProviderId } = await resolveEdgeOneProvider(providers, edgeoneProviderId)
  if (dnspodProviderId === '') {
    throw new ApiError('edgeone_dnspod_provider_not_found', 'EdgeOne provider is not linked to a DNSPod provider', 422)
  }
  const dnspod = await providers.requireType<DnsPodProvider>(
    dnspodProviderId,
    'dnspod',
    'DNSPod provider not found',
    'dnspod_provider_not_found'
  )
  return EdgeOneClient.forProvider(dnspod, timeoutMs)
}
