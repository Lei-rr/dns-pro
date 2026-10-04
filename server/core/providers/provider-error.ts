import { ApiError } from '../http/api-error.js'

function upstreamStatus(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null
  const details = error.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = Number((details as Record<string, unknown>).upstream_status)
  return Number.isInteger(value) ? value : null
}

// 上游限流错误码（腾讯云 RequestLimitExceeded / 通用 TooManyRequests 等）
const RATE_LIMIT_CODE = /(?:RequestLimitExceeded|LimitExceeded|TooManyRequests|RateLimit)/i

function upstreamDetails(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiError)) return null
  const { details } = error
  return details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : null
}

/** 上游以业务错误码返回限流（如腾讯云 RequestLimitExceeded） */
export function hasRateLimitCode(error: unknown): boolean {
  const details = upstreamDetails(error)
  return Boolean(details && RATE_LIMIT_CODE.test(String(details.code ?? '')))
}

/** 上游以 HTTP 429 限流（HTTP 200 + 业务限流码见 hasRateLimitCode） */
export function isHttpRateLimited(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return Number(upstreamDetails(error)?.upstream_status) === 429 || error.statusCode === 429
}

/** 上游要求的等待毫秒数（Retry-After），无有效值返回 null */
export function retryAfterMs(error: unknown): number | null {
  const value = upstreamDetails(error)?.retry_after_ms
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

type ExplicitNotFoundOptions = {
  providerCode?: RegExp
  localCodes?: readonly string[]
}

export function isExplicitNotFound(error: unknown, options: ExplicitNotFoundOptions = {}): boolean {
  if (!(error instanceof ApiError)) return false
  if (upstreamStatus(error) === 404) return true
  if (options.localCodes?.includes(error.code)) return true
  if (!options.providerCode) return false
  const details = error.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false
  return options.providerCode.test(String((details as Record<string, unknown>).code ?? ''))
}
