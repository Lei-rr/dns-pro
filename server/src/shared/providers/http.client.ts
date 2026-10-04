import { ApiError } from '../http/api-error.js'
import { hasRateLimitCode, isProviderRateLimited, retryAfterMs } from './provider-error.js'

interface HttpClientOptions {
  baseURL: string
  headers?: Record<string, string>
  timeout?: number
}

export interface HttpRequestConfig {
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

/**
 * 拼接上游 URL。拒绝 `.`/`..`/空段与绝对地址，确保最终请求不会逃逸出 baseURL
 * （例如记录 ID 为 `..` 时把「删除记录」变成「删除站点」）。
 */
function buildUrl(baseURL: string, path: string, params?: Record<string, unknown>): string {
  const base = new URL(baseURL.endsWith('/') ? baseURL : `${baseURL}/`)
  const relative = path.startsWith('/') ? path.slice(1) : path
  const segments = relative === '' ? [] : relative.split('/')
  if (segments.some((segment) => segment === '' || /^(?:\.|%2e){1,2}$/i.test(segment))) {
    throw new ApiError('invalid_upstream_path', 'Invalid upstream request path', 400)
  }
  const url = new URL(relative, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new ApiError('invalid_upstream_path', 'Invalid upstream request path', 400)
  }

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

const MAX_RETRIES = 2
const INITIAL_BACKOFF_MS = 150
/** 上游要求等待超过该值时不再重试，直接把限流错误抛给调用方（避免长时间占用请求） */
const MAX_RETRY_AFTER_MS = 10000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 是否重试：
 * - 限流（429 / 上游限流错误码）：请求未被应用，任何方法都可重试
 * - 5xx：仅幂等方法（GET/HEAD）重试，避免非幂等请求被重复执行
 */
function shouldRetry(method: string, error: unknown): boolean {
  if (isProviderRateLimited(error)) return true
  if (method !== 'GET' && method !== 'HEAD') return false
  if (error instanceof ApiError) {
    const upstreamStatus = (error.details as Record<string, unknown> | undefined)?.upstream_status
    if (typeof upstreamStatus === 'number') return [500, 502, 503, 504].includes(upstreamStatus)
    return error.statusCode === 502
  }
  return true
}

/** 重试等待：优先遵循上游 Retry-After，否则指数退避；超过上限返回 null 表示放弃重试 */
function retryDelayMs(error: unknown, attempt: number): number | null {
  const requested = retryAfterMs(error)
  if (requested === null) return INITIAL_BACKOFF_MS * 2 ** (attempt - 1)
  return requested > MAX_RETRY_AFTER_MS ? null : requested
}

/**
 * 业务层限流重试：用于「HTTP 200 + 业务错误码」的供应商（腾讯云）。
 * HTTP 层限流已由 request() 处理，这里只处理业务错误码。
 */
export async function withRateLimitRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt >= MAX_RETRIES || !hasRateLimitCode(error)) throw error
      const delay = retryDelayMs(error, attempt + 1)
      if (delay === null) throw error
      await sleep(delay)
    }
  }
}

/** 解析 Retry-After：秒数或 HTTP 日期，非法值返回 undefined */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

export class BaseHttpClient {
  protected readonly baseURL: string
  protected readonly defaultHeaders: Record<string, string>
  protected readonly timeout: number

  constructor(options: HttpClientOptions) {
    this.baseURL = options.baseURL
    this.defaultHeaders = { ...(options.headers ?? {}) }
    this.timeout = options.timeout ?? defaultHttpTimeoutMs
  }

  protected async request(config: HttpRequestConfig): Promise<unknown> {
    const method = (config.method ?? 'GET').toUpperCase()
    const maxAttempts = 1 + MAX_RETRIES

    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = retryDelayMs(lastError, attempt)
        // 上游要求的等待过长：不再重试，让调用方稍后重试
        if (delay === null) break
        await sleep(delay)
      }
      try {
        return await this.sendOnce(method, config)
      } catch (error) {
        lastError = error
        if (attempt === maxAttempts - 1 || !shouldRetry(method, error)) throw error
      }
    }
    throw lastError
  }

  private async sendOnce(method: string, config: HttpRequestConfig): Promise<unknown> {
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
        const details = { upstream_status: response.status, upstream_body: data }
        if (response.status === 429) {
          throw new ApiError('provider_rate_limited', '服务商接口限流，请稍后重试', 429, {
            ...details,
            retry_after_ms: parseRetryAfterMs(response.headers.get('retry-after')),
          })
        }
        throw new ApiError(
          'http_error',
          `Provider API error: ${response.status} ${response.statusText}`,
          response.status >= 500 ? 502 : 400,
          details
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
