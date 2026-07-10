import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { ApiError } from '../support/api-error.js'

export interface GatewayOptions {
  baseURL: string
  headers?: Record<string, string>
  timeout?: number
}

let defaultHttpTimeoutMs = 30000

export function setDefaultHttpTimeout(ms: number): void {
  defaultHttpTimeoutMs = Math.max(1000, Math.min(300000, ms))
}

export function getDefaultHttpTimeout(): number {
  return defaultHttpTimeoutMs
}

export class BaseGateway {
  protected readonly client: AxiosInstance

  constructor(options: GatewayOptions) {
    this.client = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeout ?? defaultHttpTimeoutMs,
      headers: options.headers,
    })
  }

  protected async request(config: AxiosRequestConfig): Promise<unknown> {
    try {
      const response: AxiosResponse<unknown> = await this.client.request(config)
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new ApiError(
          'http_error',
          `Provider API error: ${error.response.status} ${error.message}`,
          error.response.status >= 500 ? 502 : 400,
          error.response.data
        )
      }
      throw new ApiError('http_error', `Provider API request failed: ${error instanceof Error ? error.message : String(error)}`, 502)
    }
  }
}
