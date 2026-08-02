import { TencentCloudGateway, type TencentCloudCredentials } from '../../shared/providers/tencent-cloud.client.js'

export type DnsPodCredentials = TencentCloudCredentials

export class DnsPodGateway extends TencentCloudGateway {
  /** Create a short-lived gateway so replaced credentials are not retained in a process-global map. */
  static forCredentials(credentials: DnsPodCredentials): DnsPodGateway {
    return new DnsPodGateway({
      secretId: credentials.secretId.trim(),
      secretKey: credentials.secretKey.trim(),
    })
  }

  constructor(credentials: DnsPodCredentials) {
    super(credentials, {
      endpoint: 'dnspod.tencentcloudapi.com',
      service: 'dnspod',
      version: '2021-03-23',
      errorCode: 'dnspod_request_failed',
      errorPrefix: 'DNSPod API error',
    })
  }
}
