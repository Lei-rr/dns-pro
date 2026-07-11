import { z } from 'zod'
import { BaseGateway, type GatewayRequestConfig } from '../../../lib/http/base-gateway.js'
import { ApiError } from '../../../lib/http/api-error.js'

export interface CloudflareApiResponse<T = unknown> {
  success: boolean
  errors: unknown[]
  messages: unknown[]
  result: T
  result_info?: Record<string, unknown>
}

const cloudflareErrorSchema = z
  .object({
    message: z.string().optional(),
  })
  .passthrough()

export class CloudflareGateway extends BaseGateway {
  constructor(apiToken: string) {
    super({
      baseURL: 'https://api.cloudflare.com/client/v4',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    })
  }

  async get(path: string, params?: Record<string, unknown>): Promise<CloudflareApiResponse<unknown>> {
    return this.call({ method: 'GET', url: path, params })
  }

  async post(path: string, data?: unknown): Promise<CloudflareApiResponse<unknown>> {
    return this.call({ method: 'POST', url: path, data })
  }

  async put(path: string, data?: unknown): Promise<CloudflareApiResponse<unknown>> {
    return this.call({ method: 'PUT', url: path, data })
  }

  async patch(path: string, data?: unknown): Promise<CloudflareApiResponse<unknown>> {
    return this.call({ method: 'PATCH', url: path, data })
  }

  async delete(path: string): Promise<CloudflareApiResponse<unknown>> {
    return this.call({ method: 'DELETE', url: path })
  }

  private async call(config: GatewayRequestConfig): Promise<CloudflareApiResponse<unknown>> {
    try {
      const response = await this.request(config)
      const parsed = cloudflareResponseSchema.parse(response)
      if (!parsed.success) {
        this.throwCloudflareError(parsed)
      }
      return parsed
    } catch (error) {
      if (error instanceof ApiError && error.code === 'http_error' && error.statusCode === 502 && !error.details) {
        throw new ApiError('cloudflare_connection_failed', 'Cloudflare connection failed', 502, {
          original_error: error.message,
        })
      }
      throw error
    }
  }

  private throwCloudflareError(response: CloudflareApiResponse<unknown>): never {
    const firstError =
      Array.isArray(response.errors) && response.errors.length > 0
        ? String(cloudflareErrorSchema.safeParse(response.errors[0]).data?.message ?? '')
        : ''
    const detail = firstError !== '' ? `Cloudflare request failed: ${firstError}` : 'Cloudflare request failed'
    throw new ApiError('cloudflare_request_failed', detail, 502, { errors: response.errors })
  }
}

const cloudflareResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.unknown()),
  messages: z.array(z.unknown()),
  result: z.unknown(),
  result_info: z.record(z.string(), z.unknown()).optional(),
})
