import { TencentCloudGateway, type TencentCloudCredentials } from '../../../lib/http/tencent-cloud-gateway.js'

export type EdgeOneCredentials = TencentCloudCredentials

export class EdgeOneGateway extends TencentCloudGateway {
  constructor(credentials: EdgeOneCredentials) {
    super(credentials, {
      endpoint: 'teo.tencentcloudapi.com',
      service: 'teo',
      version: '2022-09-01',
      errorCode: 'edgeone_request_failed',
      errorPrefix: 'EdgeOne API error',
    })
  }
}
