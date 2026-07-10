import { TencentCloudGateway, type TencentCloudCredentials } from './tencent-cloud-gateway.js'

export type DnspodCredentials = TencentCloudCredentials

export class DnsPodGateway extends TencentCloudGateway {
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
