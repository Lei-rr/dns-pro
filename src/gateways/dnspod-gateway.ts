import crypto from 'node:crypto'
import { BaseGateway } from './base-gateway.js'
import { ApiError } from '../support/api-error.js'

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
const CONTENT_TYPE = 'application/json; charset=utf-8'

export class DnsPodGateway extends BaseGateway {
  private readonly secretId: string
  private readonly secretKey: string

  constructor(credentials: DnspodCredentials) {
    super({
      baseURL: `https://${ENDPOINT}`,
      timeout: 30000,
      headers: {
        'Content-Type': CONTENT_TYPE,
        Host: ENDPOINT,
      },
    })
    this.secretId = credentials.secretId
    this.secretKey = credentials.secretKey
  }

  async call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T & { RequestId?: string }> {
    const timestamp = Math.floor(Date.now() / 1000)
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    const body = JSON.stringify(payload)
    const payloadHash = this.sha256(body)

    const signedHeaders = 'content-type;host;x-tc-action'
    const canonicalHeaders = [
      `content-type:${CONTENT_TYPE}`,
      `host:${ENDPOINT}`,
      `x-tc-action:${action.toLowerCase()}`,
      '',
    ].join('\n')

    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const credentialScope = `${date}/${SERVICE}/tc3_request`
    const stringToSign = [
      'TC3-HMAC-SHA256',
      String(timestamp),
      credentialScope,
      this.sha256(canonicalRequest),
    ].join('\n')

    const signature = this.calculateSignature(stringToSign, date)
    const authorization =
      `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`

    const response = await this.request<DnspodResponse<T>>({
      method: 'POST',
      url: '/',
      headers: {
        'Content-Type': CONTENT_TYPE,
        Host: ENDPOINT,
        'X-TC-Action': action,
        'X-TC-Version': VERSION,
        'X-TC-Timestamp': String(timestamp),
        Authorization: authorization,
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

  private sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex')
  }

  private calculateSignature(stringToSign: string, date: string): string {
    const secretDate = crypto.createHmac('sha256', `TC3${this.secretKey}`).update(date).digest()
    const secretService = crypto.createHmac('sha256', secretDate).update(SERVICE).digest()
    const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest()
    return crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
  }
}
