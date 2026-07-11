import { ApiError } from './api-error.js'

export interface GatewayOptions {
  baseURL: string
  headers?: Record<string, string>
  timeout?: number
}

export interface GatewayRequestConfig {
  method?: string
  url: string
  headers?: Record<string, string>
  params?: Record<string, unknown>
  data?: unknown
  timeout?: number
}

let defaultHttpTimeoutMs = 30000

export function setDefaultHttpTimeout(ms: number): void {
  defaultHttpTimeoutMs = Math.max(1000, Math.min(300000, ms))
}

export function getDefaultHttpTimeout(): number {
  return defaultHttpTimeoutMs
}

function buildUrl(baseURL: string, path: string, params?: Record<string, unknown>): string {
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  const relative = path.startsWith('/') ? path.slice(1) : path
  const url = new URL(relative, base)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

export class BaseGateway {
  protected readonly baseURL: string
  protected readonly defaultHeaders: Record<string, string>
  protected readonly timeout: number

  constructor(options: GatewayOptions) {
    this.baseURL = options.baseURL
    this.defaultHeaders = { ...(options.headers ?? {}) }
    this.timeout = options.timeout ?? defaultHttpTimeoutMs
  }

  protected async request(config: GatewayRequestConfig): Promise<unknown> {
    const method = (config.method ?? 'GET').toUpperCase()
    const url = buildUrl(this.baseURL, config.url, config.params)
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(config.headers ?? {}),
    }

    let body: string | undefined
    if (config.data !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (typeof config.data === 'string') {
        body = config.data
      } else {
        body = JSON.stringify(config.data)
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json'
        }
      }
    }

    const controller = new AbortController()
    const timeoutMs = config.timeout ?? this.timeout
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      })

      const text = await response.text()
      let data: unknown = text
      if (text !== '') {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      } else {
        data = null
      }

      if (!response.ok) {
        throw new ApiError(
          'http_error',
          `Provider API error: ${response.status} ${response.statusText}`,
          response.status >= 500 ? 502 : 400,
          data
        )
      }

      return data
    } catch (error) {
      if (error instanceof ApiError) throw error

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError('http_error', `Provider API request timed out after ${timeoutMs}ms`, 502)
      }

      throw new ApiError(
        'http_error',
        `Provider API request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
