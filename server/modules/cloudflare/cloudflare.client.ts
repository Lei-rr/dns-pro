import { ApiError } from '../../core/http/api-error.js'
import { BaseHttpClient, type HttpRequestConfig } from '../../core/http/base-http.client.js'
import type { CloudflareProvider } from '../../core/providers/provider.types.js'

interface CloudflareApiResponse {
  success?: boolean
  errors?: unknown[]
  messages?: unknown[]
  result?: unknown
  result_info?: Record<string, unknown>
}

/** Cloudflare v4 API 客户端（按次创建，避免进程内长期持有已替换的 Token） */
export class CloudflareClient extends BaseHttpClient {
  static forProvider(provider: Pick<CloudflareProvider, 'api_token'>, timeoutMs?: number): CloudflareClient {
    return new CloudflareClient(provider.api_token.trim(), timeoutMs)
  }

  constructor(apiToken: string, timeoutMs?: number) {
    super({
      baseURL: 'https://api.cloudflare.com/client/v4',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    })
  }

  get(path: string, params?: Record<string, unknown>): Promise<CloudflareApiResponse> {
    return this.send({ method: 'GET', url: path, params })
  }

  post(path: string, data?: unknown): Promise<CloudflareApiResponse> {
    return this.send({ method: 'POST', url: path, data })
  }

  put(path: string, data?: unknown): Promise<CloudflareApiResponse> {
    return this.send({ method: 'PUT', url: path, data })
  }

  patch(path: string, data?: unknown): Promise<CloudflareApiResponse> {
    return this.send({ method: 'PATCH', url: path, data })
  }

  delete(path: string): Promise<CloudflareApiResponse> {
    return this.send({ method: 'DELETE', url: path })
  }

  private async send(config: HttpRequestConfig): Promise<CloudflareApiResponse> {
    try {
      const response = (await this.request(config)) as CloudflareApiResponse | null
      if (response?.success === false) throw cloudflareError(response)
      return response ?? {}
    } catch (error) {
      // 网络层失败（无上游响应体）统一为连接失败
      if (error instanceof ApiError && error.code === 'http_error' && error.statusCode === 502 && !error.details) {
        throw new ApiError('cloudflare_connection_failed', 'Cloudflare connection failed', 502, {
          original_error: error.message,
        })
      }
      throw error
    }
  }
}

function cloudflareError(response: CloudflareApiResponse): ApiError {
  const first = Array.isArray(response.errors) ? response.errors[0] : null
  const message =
    first && typeof first === 'object' && 'message' in first ? String((first as { message?: unknown }).message) : ''
  return new ApiError(
    'cloudflare_request_failed',
    message ? `Cloudflare request failed: ${message}` : 'Cloudflare request failed',
    502,
    { errors: response.errors }
  )
}
