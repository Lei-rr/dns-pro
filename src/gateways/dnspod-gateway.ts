import { BaseGateway } from './base-gateway.js'
import { ApiError } from '../support/api-error.js'
import { signTencentTc3, TENCENT_CONTENT_TYPE } from './tencent-tc3.js'

export interface DnspodCredentials {
  secretId: string
  secretKey: string
}

export interface DnspodResponse<T> {
  Response: T & {
    RequestId?: string
    Error?: {
      Code: string
      Message: string
    }
  }
}

const ENDPOINT = 'dnspod.tencentcloudapi.com'
const SERVICE = 'dnspod'
const VERSION = '2021-03-23'
export class DnsPodGateway extends BaseGateway {
  private readonly secretId: string
  private readonly secretKey: string

  constructor(credentials: DnspodCredentials) {
    super({
      baseURL: `https://${ENDPOINT}`,
      timeout: 30000,
      headers: {
        'Content-Type': TENCENT_CONTENT_TYPE,
        Host: ENDPOINT,
      },
    })
    this.secretId = credentials.secretId
    this.secretKey = credentials.secretKey
  }

  async call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T & { RequestId?: string }> {
    const timestamp = Math.floor(Date.now() / 1000)
    const body = JSON.stringify(payload)

    const response = await this.request<DnspodResponse<T>>({
      method: 'POST',
      url: '/',
      headers: {
        ...signTencentTc3({
          secretId: this.secretId,
          secretKey: this.secretKey,
          service: SERVICE,
          endpoint: ENDPOINT,
          action,
          body,
          timestamp,
        }),
        'X-TC-Version': VERSION,
      },
      data: body,
    })

    if (response.Response.Error) {
      throw new ApiError(
        'dnspod_request_failed',
        `DNSPod API error: ${response.Response.Error.Code} ${response.Response.Error.Message}`,
        502,
        {
          code: response.Response.Error.Code,
          message: response.Response.Error.Message,
          request_id: response.Response.RequestId,
        }
      )
    }

    return response.Response
  }
}
