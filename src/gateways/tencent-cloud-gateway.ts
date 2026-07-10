import { z } from 'zod'
import { BaseGateway } from './base-gateway.js'
import { ApiError } from '../support/api-error.js'
import { signTencentTc3, TENCENT_CONTENT_TYPE } from './tencent-tc3.js'

export interface TencentCloudCredentials {
  secretId: string
  secretKey: string
}

export interface TencentCloudResponse<T> {
  Response: T & {
    RequestId?: string
    Error?: {
      Code: string
      Message: string
    }
  }
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

    const response = await this.request({
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
    })

    const parsed = tencentCloudResponseSchema.parse(response)
    if (parsed.Response.Error) {
      throw new ApiError(
        this.options.errorCode,
        `${this.options.errorPrefix}: ${parsed.Response.Error.Code} ${parsed.Response.Error.Message}`,
        502,
        {
          code: parsed.Response.Error.Code,
          message: parsed.Response.Error.Message,
          request_id: parsed.Response.RequestId,
        }
      )
    }

    return parsed.Response
  }
}

const tencentCloudErrorSchema = z.object({
  Code: z.string(),
  Message: z.string(),
})

const tencentCloudResponseSchema = z.object({
  Response: z.record(z.string(), z.unknown()).and(
    z.object({
      RequestId: z.string().optional(),
      Error: tencentCloudErrorSchema.optional(),
    })
  ),
})
