import { TencentCloudGateway, type TencentCloudCredentials } from '../../../lib/http/tencent-cloud-gateway.js'

export type DnspodCredentials = TencentCloudCredentials

export class DnsPodGateway extends TencentCloudGateway {
  private static readonly byKey = new Map<string, DnsPodGateway>()

  /** Reuse gateway instances per credential pair within the process. */
  static forCredentials(credentials: DnspodCredentials): DnsPodGateway {
    const key = `${credentials.secretId.trim()}\0${credentials.secretKey.trim()}`
    let gateway = this.byKey.get(key)
    if (!gateway) {
      gateway = new DnsPodGateway({
        secretId: credentials.secretId.trim(),
        secretKey: credentials.secretKey.trim(),
      })
      this.byKey.set(key, gateway)
    }
    return gateway
  }

  constructor(credentials: DnspodCredentials) {
    super(credentials, {
      endpoint: 'dnspod.tencentcloudapi.com',
      service: 'dnspod',
      version: '2021-03-23',
      errorCode: 'dnspod_request_failed',
      errorPrefix: 'DNSPod API error',
    })
  }
}
