import { ApiError } from '../http/api-error.js'
import { BaseHttpClient, withRateLimitRetry } from '../http/base-http.client.js'
import { asRecord } from './response-guards.js'
import { signTencentTc3, TENCENT_CONTENT_TYPE } from './tc3-signer.js'

interface TencentCloudCredentials {
  secretId: string
  secretKey: string
}

interface TencentCloudClientOptions {
  endpoint: string
  service: string
  version: string
  errorCode: string
  errorPrefix: string
}

/** 腾讯云 API 3.0 客户端（TC3-HMAC-SHA256 签名） */
export class TencentCloudClient extends BaseHttpClient {
  constructor(
    private readonly credentials: TencentCloudCredentials,
    private readonly options: TencentCloudClientOptions,
    timeoutMs?: number
  ) {
    super({
      baseURL: `https://${options.endpoint}`,
      headers: { 'Content-Type': TENCENT_CONTENT_TYPE, Host: options.endpoint },
      timeout: timeoutMs,
    })
  }

  /** 调用 Action，返回 Response 主体；上游业务错误转为 ApiError（限流自动重试） */
  call(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return withRateLimitRetry(() => this.send(action, payload))
  }

  private async send(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = JSON.stringify(payload)
    const raw = await this.request({
      method: 'POST',
      url: '/',
      headers: {
        ...signTencentTc3({
          secretId: this.credentials.secretId,
          secretKey: this.credentials.secretKey,
          service: this.options.service,
          endpoint: this.options.endpoint,
          action,
          body,
        }),
        'X-TC-Version': this.options.version,
      },
      data: body,
    })

    const envelope = asRecord(raw)
    const response = 'Response' in envelope ? asRecord(envelope.Response) : envelope
    const err = response.Error && typeof response.Error === 'object' ? asRecord(response.Error) : null
    if (err) {
      throw new ApiError(
        this.options.errorCode,
        `${this.options.errorPrefix}: ${err.Code ?? ''} ${err.Message ?? ''}`.trim(),
        502,
        { code: err.Code, message: err.Message, request_id: response.RequestId }
      )
    }
    return response
  }
}
