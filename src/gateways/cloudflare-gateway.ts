import axios, { type AxiosRequestConfig } from 'axios'
import { BaseGateway } from './base-gateway.js'
import { ApiError } from '../support/api-error.js'

export interface CloudflareApiResponse<T = unknown> {
  success: boolean
  errors: unknown[]
  messages: unknown[]
  result: T
  result_info?: Record<string, unknown>
}

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

  async get<T>(path: string, params?: Record<string, unknown>): Promise<CloudflareApiResponse<T>> {
    const response = await this.call<T>({ method: 'GET', url: path, params })
    return response
  }

  async post<T>(path: string, data?: Record<string, unknown>): Promise<CloudflareApiResponse<T>> {
    const response = await this.call<T>({ method: 'POST', url: path, data })
    return response
  }

  async put<T>(path: string, data?: Record<string, unknown>): Promise<CloudflareApiResponse<T>> {
    const response = await this.call<T>({ method: 'PUT', url: path, data })
    return response
  }

  async patch<T>(path: string, data?: Record<string, unknown>): Promise<CloudflareApiResponse<T>> {
    const response = await this.call<T>({ method: 'PATCH', url: path, data })
    return response
  }

  async delete<T>(path: string): Promise<CloudflareApiResponse<T>> {
    const response = await this.call<T>({ method: 'DELETE', url: path })
    return response
  }

  private async call<T>(config: AxiosRequestConfig): Promise<CloudflareApiResponse<T>> {
    try {
      const response = await this.request<CloudflareApiResponse<T>>(config)
      if (!response.success) {
        this.throwCloudflareError(response)
      }
      return response
    } catch (error) {
      if (axios.isAxiosError(error) && !error.response) {
        throw new ApiError(
          'cloudflare_connection_failed',
          'Cloudflare connection failed',
          502,
          { original_error: error.message }
        )
      }
      throw error
    }
  }

  private throwCloudflareError(response: CloudflareApiResponse<unknown>): never {
    const firstError =
      Array.isArray(response.errors) && response.errors.length > 0
        ? String((response.errors[0] as { message?: string }).message ?? '')
        : ''
    const detail = firstError !== '' ? `Cloudflare request failed: ${firstError}` : 'Cloudflare request failed'
    throw new ApiError('cloudflare_request_failed', detail, 502, { errors: response.errors })
  }
}
