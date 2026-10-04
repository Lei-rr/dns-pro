import { TencentCloudClient } from '../../kernel/providers/tencent-cloud.client.js'
import type { ProviderRepository } from '../../kernel/providers/provider.repository.js'
import type { DnsPodProvider } from '../../kernel/providers/provider.types.js'

/** DNSPod API 客户端（按次创建，避免进程内长期持有已替换的密钥） */
export class DnsPodClient extends TencentCloudClient {
  static forProvider(provider: Pick<DnsPodProvider, 'secret_id' | 'secret_key'>): DnsPodClient {
    return new DnsPodClient(provider)
  }

  constructor(provider: Pick<DnsPodProvider, 'secret_id' | 'secret_key'>) {
    super(
      { secretId: provider.secret_id.trim(), secretKey: provider.secret_key.trim() },
      {
        endpoint: 'dnspod.tencentcloudapi.com',
        service: 'dnspod',
        version: '2021-03-23',
        errorCode: 'dnspod_request_failed',
        errorPrefix: 'DNSPod API error',
      }
    )
  }
}

/** 读取 DNSPod 服务商并创建客户端 */
export async function dnsPodClientFor(providers: ProviderRepository, providerId: string): Promise<DnsPodClient> {
  const provider = await providers.requireType<DnsPodProvider>(
    providerId,
    'dnspod',
    'DNSPod provider not found',
    'dnspod_provider_not_found'
  )
  return DnsPodClient.forProvider(provider)
}
