import { TencentCloudGateway, type TencentCloudCredentials } from '../../../lib/http/tencent-cloud-gateway.js'

export type EdgeOneCredentials = TencentCloudCredentials

export class EdgeOneGateway extends TencentCloudGateway {
  private static readonly byKey = new Map<string, EdgeOneGateway>()

  /** Reuse gateway instances per credential pair within the process. */
  static forCredentials(credentials: EdgeOneCredentials): EdgeOneGateway {
    const key = `${credentials.secretId.trim()}\0${credentials.secretKey.trim()}`
    let gateway = this.byKey.get(key)
    if (!gateway) {
      gateway = new EdgeOneGateway({
        secretId: credentials.secretId.trim(),
        secretKey: credentials.secretKey.trim(),
      })
      this.byKey.set(key, gateway)
    }
    return gateway
  }

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
