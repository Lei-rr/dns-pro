import { TencentCloudClient } from '../../kernel/providers/tencent-cloud.client.js'
import type { DnsPodProvider } from '../../kernel/providers/provider.types.js'

/** EdgeOne API 客户端：复用关联 DNSPod 的腾讯云密钥 */
export class EdgeOneClient extends TencentCloudClient {
  static forProvider(provider: Pick<DnsPodProvider, 'secret_id' | 'secret_key'>, timeoutMs?: number): EdgeOneClient {
    return new EdgeOneClient(provider, timeoutMs)
  }

  constructor(provider: Pick<DnsPodProvider, 'secret_id' | 'secret_key'>, timeoutMs?: number) {
    super(
      { secretId: provider.secret_id.trim(), secretKey: provider.secret_key.trim() },
      {
        endpoint: 'teo.tencentcloudapi.com',
        service: 'teo',
        version: '2022-09-01',
        errorCode: 'edgeone_request_failed',
        errorPrefix: 'EdgeOne API error',
      },
      timeoutMs
    )
  }
}
