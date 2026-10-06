import { ApiError } from './api-error.js'
import { hasRateLimitCode, isHttpRateLimited, retryAfterMs, upstreamStatus } from '../providers/provider-error.js'

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

/** 未显式配置时的上游超时；装配层以 config.httpTimeoutMs 构造传入，不使用模块级可变全局 */
const DEFAULT_HTTP_TIMEOUT_MS = 30000

/**
 * 拼接上游 URL。拒绝 `.`/`..`/空段与绝对地址，确保最终请求不会逃逸出 baseURL
 * （例如记录 ID 为 `..` 时把「删除记录」变成「删除站点」）。
 */
function buildUrl(baseURL: string, path: string, params?: Record<string, unknown>): string {
  const base = new URL(baseURL.endsWith('/') ? baseURL : `${baseURL}/`)
  const relative = path.startsWith('/') ? path.slice(1) : path
  const segments = relative === '' ? [] : relative.split('/')
  if (segments.some(isUnsafeSegment)) {
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

/**
 * 段级校验：先按百分号解码再判定，因为上游可能对路径二次解码 ——
 * `%2e%2e` 会还原成 `..`，`%2f` / `%5c` 会还原成新的路径分隔符，两者都能让路径逃出 baseURL。
 * 解码失败（非法编码序列）时按原文判定：它不可能被上游解析成分隔符。
 */
function isUnsafeSegment(segment: string): boolean {
  if (segment === '') return true
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }
  if (decoded.includes('/') || decoded.includes('\\')) return true
  return /^(?:\.{1,2})$/.test(decoded)
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
 * - HTTP 限流（429）：请求未被应用，任何方法都可重试
 * - 5xx：仅幂等方法（GET/HEAD）重试，避免非幂等请求被重复执行
 *
 * 业务错误码限流（HTTP 200 + 限流 Code，如腾讯云）不在这里重试：
 * 由 withRateLimitRetry 统一处理，否则两层各重试 3 次会叠加成 9 次上游请求。
 */
function shouldRetry(method: string, error: unknown): boolean {
  if (isHttpRateLimited(error)) return true
  if (method !== 'GET' && method !== 'HEAD') return false
  if (error instanceof ApiError) {
    const status = upstreamStatus(error)
    // 无 upstream_status（非 HTTP 层错误）时退回请求自身的 502 判定
    return status === null ? error.statusCode === 502 : [500, 502, 503, 504].includes(status)
  }
  return true
}

/** 指数退避：第 n 次重试等待 INITIAL_BACKOFF_MS × 2^(n-1) */
function backoffMs(attempt: number): number {
  return INITIAL_BACKOFF_MS * 2 ** (attempt - 1)
}

/**
 * HTTP 重试等待：优先遵循上游 Retry-After，否则指数退避；超过上限返回 null 表示放弃重试。
 * 只有 HTTP 429 分支会写入 retry_after_ms（见 sendOnce），调用方据此决定是否值得等待。
 */
function retryDelayMs(error: unknown, attempt: number): number | null {
  const requested = retryAfterMs(error)
  if (requested === null) return backoffMs(attempt)
  return requested > MAX_RETRY_AFTER_MS ? null : requested
}

/**
 * 业务层限流重试：用于「HTTP 200 + 业务错误码」的供应商（腾讯云）。
 * HTTP 层限流已由 request() 处理，这里只处理业务错误码：若错误本身就是 HTTP 429，
 * 说明 request() 已经用掉自己的重试预算，再叠加会放大成 3×3 次上游请求。
 */
export async function withRateLimitRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt >= MAX_RETRIES || isHttpRateLimited(error) || !hasRateLimitCode(error)) throw error
      // 业务限流码不携带 retry_after_ms（唯一写入点是 HTTP 429 分支，已被上面的 isHttpRateLimited 排除），
      // 因此这里恒为指数退避，retryDelayMs 的「等待过久放弃」分支不可达。
      await sleep(backoffMs(attempt + 1))
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
    this.timeout = options.timeout ?? DEFAULT_HTTP_TIMEOUT_MS
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
      let data: unknown
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
        if (response.status === 401 || response.status === 403) {
          // 上游鉴权失败单独归类：折叠为 400 http_error 会与参数错误混淆，且凭据类错误码不可达
          throw new ApiError('provider_credentials_invalid', 'Provider credentials rejected by upstream', 400, details)
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
