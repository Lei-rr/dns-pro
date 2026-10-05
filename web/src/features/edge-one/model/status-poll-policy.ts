/**
 * EdgeOne 停止/启用状态轮询的间隔与限流退避策略（取值依据集中在此，勿凭感觉调整）。
 *
 * 依据一 · 腾讯云文档：EdgeOne（teo 2022-09-01）默认接口请求频率限制 20 次/秒。
 * 本面板稳态 10 秒一次 ≈ 0.1 次/秒，只占该配额的 0.5%，多标签页同时停留也是同一数量级。
 * 依据二 · Cloudflare Rate limits 文档：Client API 每 token 1200 次/5 分钟（均值约 4 次/秒）、
 * 每 IP 200 次/秒，超出后全 API 阻止 5 分钟，且官方 SDK 会遵循响应中的重试时间语义。
 * 本面板速率同样远低于该档；「分钟级惩罚窗口」也是退避上限取 300s 的量级依据。
 * 依据三 · 本仓 server/core/http/base-http.client.ts：MAX_RETRIES = 2 且 MAX_RETRY_AFTER_MS = 10000，
 * 即后端单次请求最坏要经历 2 次等待（合计 20s，超过 10s 的等待会放弃重试）。
 * 因此限流退避起点取 60s：前端不会在后端重试链尚未结束时又以原节奏叠加新请求。
 */

/** 起步 3s：轮询只在下发到落定之间进行，越快看到落定越好；该速率对上游配额可忽略 */
export const STATUS_POLL_FIRST_MS = 3000

/** 每轮 +1s 线性放缓：长时间未落定时逐步降压，配合「页面不可见即停表」控制请求总量 */
export const STATUS_POLL_STEP_MS = 1000

/**
 * 稳态上限 10s：与 base-http.client.ts 的 MAX_RETRY_AFTER_MS 同值是有意对齐，不是巧合 ——
 * 常规节奏不快于后端对限流的处置节奏；一旦真被限流则切到下面的更长退避。
 */
export const STATUS_POLL_MAX_MS = 10000

/** 限流退避起点 60s：≥ 后端单次调用最坏耗时（2 × MAX_RETRY_AFTER_MS = 20s）的 3 倍余量 */
export const STATUS_POLL_RATE_LIMIT_MIN_MS = 60000

/** 限流退避上限 300s：与 Cloudflare 文档的 5 分钟惩罚窗口同量级；只封顶自动增长，不压制服务端明确要求 */
export const STATUS_POLL_RATE_LIMIT_MAX_MS = 300000

/** 常规节奏推进：线性放缓至上限 */
export function nextStatusPollDelayMs(currentMs: number): number {
  return Math.min(STATUS_POLL_MAX_MS, currentMs + STATUS_POLL_STEP_MS)
}

/** 限流信号：hintMs 为服务端明确要求的等待时长（未给出则为 null，按固定退避处理） */
export interface StatusPollRateLimit {
  retryAfterMs: number | null
}

/** 与 server/core/providers/provider-error.ts 的 RATE_LIMIT_CODE 保持同形（前端不能 import 后端模块）。
 *  腾讯云以「HTTP 200 + 业务错误码」表达限流，落到前端是 502 响应体里的 details.code。 */
const RATE_LIMIT_CODE = /(?:RequestLimitExceeded|LimitExceeded|TooManyRequests|RateLimit)/i

/**
 * 识别一次刷新失败是否为限流：HTTP 429（provider_rate_limited）、上游 429 的 upstream_status，
 * 或腾讯云业务限流码。等待时长兼容两种键名：retry_after_ms（毫秒，base-http.client 的键）与
 * retry_after（秒，error-handler 白名单当前唯一放行的键）；provider 限流路径的 retry_after_ms
 * 会被白名单裁掉，故通常为 null，走固定退避。
 */
export function statusPollRateLimit(error: unknown): StatusPollRateLimit | null {
  if (!error || typeof error !== 'object') return null
  const record = error as { code?: unknown; status?: unknown; details?: unknown }
  const details =
    record.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? (record.details as Record<string, unknown>)
      : {}
  const limited =
    Number(record.status) === 429 ||
    String(record.code ?? '') === 'provider_rate_limited' ||
    Number(details.upstream_status) === 429 ||
    RATE_LIMIT_CODE.test(String(details.code ?? ''))
  return limited ? { retryAfterMs: retryAfterHintMs(details) } : null
}

/** 服务端给出的等待时长：非法值与非正值视为未给出 */
function retryAfterHintMs(details: Record<string, unknown>): number | null {
  const milliseconds = Number(details.retry_after_ms)
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds
  const seconds = Number(details.retry_after)
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
  return null
}

/**
 * 限流退避：以 60s 起步，连续限流翻倍至 300s 封顶；服务端明确给出更长等待时以服务端为准。
 * 一直限流就一直等待，不放弃轮询 —— 何时收口仍由待落定指令决定。
 */
export function nextStatusPollRateLimitDelayMs(previousMs: number, hintMs: number | null): number {
  const grown = previousMs > 0 ? Math.min(previousMs * 2, STATUS_POLL_RATE_LIMIT_MAX_MS) : STATUS_POLL_RATE_LIMIT_MIN_MS
  return Math.max(hintMs ?? 0, grown)
}
