import { BaseGateway } from './base-gateway.js'
import { ApiError } from '../support/api-error.js'
import { signTencentTc3, TENCENT_CONTENT_TYPE } from './tencent-tc3.js'

export interface EdgeOneCredentials {
  secretId: string
  secretKey: string
}

export interface EdgeOneResponse<T> {
  Response: T & {
    RequestId?: string
    Error?: {
      Code: string
      Message: string
    }
  }
}

const ENDPOINT = 'teo.tencentcloudapi.com'
const SERVICE = 'teo'
const VERSION = '2022-09-01'
export class EdgeOneGateway extends BaseGateway {
  private readonly secretId: string
  private readonly secretKey: string

  constructor(credentials: EdgeOneCredentials) {
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

    const response = await this.request<EdgeOneResponse<T>>({
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
        'edgeone_request_failed',
        `EdgeOne API error: ${response.Response.Error.Code} ${response.Response.Error.Message}`,
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
