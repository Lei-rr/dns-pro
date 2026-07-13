import { BaseGateway } from './base-gateway.js'
import { ApiError } from './api-error.js'
import { signTencentTc3, TENCENT_CONTENT_TYPE } from './tencent-tc3.js'

export interface TencentCloudCredentials {
  secretId: string
  secretKey: string
}

export interface TencentCloudGatewayOptions {
  endpoint: string
  service: string
  version: string
  errorCode: string
  errorPrefix: string
}

export class TencentCloudGateway extends BaseGateway {
  constructor(
    credentials: TencentCloudCredentials,
    private readonly options: TencentCloudGatewayOptions
  ) {
    super({
      baseURL: `https://${options.endpoint}`,
      headers: {
        'Content-Type': TENCENT_CONTENT_TYPE,
        Host: options.endpoint,
      },
    })

    this.secretId = credentials.secretId
    this.secretKey = credentials.secretKey
  }

  private readonly secretId: string
  private readonly secretKey: string

  async call(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const timestamp = Math.floor(Date.now() / 1000)
    const body = JSON.stringify(payload)

    const response = (await this.request({
      method: 'POST',
      url: '/',
      headers: {
        ...signTencentTc3({
          secretId: this.secretId,
          secretKey: this.secretKey,
          service: this.options.service,
          endpoint: this.options.endpoint,
          action,
          body,
          timestamp,
        }),
        'X-TC-Version': this.options.version,
      },
      data: body,
    })) as Record<string, any>

    const Response = (response?.Response ?? response ?? {}) as Record<string, any>
    if (Response.Error) {
      throw new ApiError(
        this.options.errorCode,
        `${this.options.errorPrefix}: ${Response.Error.Code ?? ''} ${Response.Error.Message ?? ''}`.trim(),
        502,
        {
          code: Response.Error.Code,
          message: Response.Error.Message,
          request_id: Response.RequestId,
        }
      )
    }

    return Response
  }
}
