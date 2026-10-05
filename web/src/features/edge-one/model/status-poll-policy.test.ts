import { describe, expect, it } from 'vitest'
import {
  STATUS_POLL_FIRST_MS,
  STATUS_POLL_MAX_MS,
  STATUS_POLL_RATE_LIMIT_MAX_MS,
  STATUS_POLL_RATE_LIMIT_MIN_MS,
  nextStatusPollDelayMs,
  nextStatusPollRateLimitDelayMs,
  statusPollRateLimit,
} from './status-poll-policy'

describe('常规轮询节奏（依据：轮询只在下发到落定之间进行，速率对上游配额可忽略）', () => {
  it('起步 3s、稳态上限 10s：10s 与后端 MAX_RETRY_AFTER_MS 有意对齐', () => {
    expect(STATUS_POLL_FIRST_MS).toBe(3000)
    expect(STATUS_POLL_MAX_MS).toBe(10000)
  })

  it('从 3s 起每轮线性 +1s，到 10s 封顶后不再增长', () => {
    const delays: number[] = []
    let current = STATUS_POLL_FIRST_MS
    for (let round = 0; round < 10; round += 1) {
      delays.push(current)
      current = nextStatusPollDelayMs(current)
    }
    expect(delays).toEqual([3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 10000, 10000])
  })

  it('封顶是幂等的：已经在 10s 或更高时推进仍返回 10s', () => {
    expect(nextStatusPollDelayMs(STATUS_POLL_MAX_MS)).toBe(STATUS_POLL_MAX_MS)
    expect(nextStatusPollDelayMs(30000)).toBe(STATUS_POLL_MAX_MS)
  })
})

describe('限流识别（429 / provider_rate_limited / upstream_status=429 / 腾讯云业务限流码）', () => {
  it('非限流失败不触发退避：网络错误、上游参数错误、真机遇到的 ResourceInUse/OperationDenied', () => {
    expect(statusPollRateLimit(undefined)).toBeNull()
    expect(statusPollRateLimit(null)).toBeNull()
    expect(statusPollRateLimit('boom')).toBeNull()
    expect(statusPollRateLimit(new Error('boom'))).toBeNull()
    expect(statusPollRateLimit({ code: 'http_error', status: 502 })).toBeNull()
    expect(
      statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { code: 'ResourceInUse' } })
    ).toBeNull()
    expect(
      statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { code: 'OperationDenied' } })
    ).toBeNull()
  })

  it('HTTP 429 与 provider_rate_limited 都算限流（未给出等待时长时按固定退避）', () => {
    expect(statusPollRateLimit({ status: 429 })).toEqual({ retryAfterMs: null })
    expect(statusPollRateLimit({ code: 'provider_rate_limited', status: 429 })).toEqual({ retryAfterMs: null })
  })

  it('腾讯云以「HTTP 200 + 业务错误码」表达限流，落到前端是 details.code 上的限流码', () => {
    const edgeOneFailed = (code: string) => ({ code: 'edgeone_request_failed', status: 502, details: { code } })
    expect(statusPollRateLimit(edgeOneFailed('RequestLimitExceeded'))).toEqual({ retryAfterMs: null })
    expect(statusPollRateLimit(edgeOneFailed('RequestLimitExceeded.Rate'))).toEqual({ retryAfterMs: null })
    expect(statusPollRateLimit(edgeOneFailed('TooManyRequests'))).toEqual({ retryAfterMs: null })
    expect(statusPollRateLimit(edgeOneFailed('rateLimit'))).toEqual({ retryAfterMs: null })
  })

  it('上游 429 透传在 details.upstream_status 时同样识别', () => {
    expect(
      statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { upstream_status: 429 } })
    ).toEqual({ retryAfterMs: null })
    expect(
      statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { upstream_status: 500 } })
    ).toBeNull()
  })

  it('details 为非对象（数组 / 字符串）时按未给出处理，不做误判', () => {
    expect(statusPollRateLimit({ status: 429, details: ['retry_after_ms'] })).toEqual({ retryAfterMs: null })
    expect(statusPollRateLimit({ status: 429, details: 'nope' })).toEqual({ retryAfterMs: null })
  })
})

describe('服务端等待时长的解析与优先级（retry_after 按秒、retry_after_ms 按毫秒、毫秒优先）', () => {
  it('retry_after 按秒换算为毫秒', () => {
    expect(statusPollRateLimit({ status: 429, details: { retry_after: 300 } })).toEqual({ retryAfterMs: 300000 })
    expect(statusPollRateLimit({ status: 429, details: { retry_after: 2.5 } })).toEqual({ retryAfterMs: 2500 })
  })

  it('retry_after_ms 按毫秒直取', () => {
    expect(statusPollRateLimit({ status: 429, details: { retry_after_ms: 2500 } })).toEqual({ retryAfterMs: 2500 })
  })

  it('两个键同时存在时毫秒优先（base-http.client 的键），秒键只作兜底', () => {
    expect(statusPollRateLimit({ status: 429, details: { retry_after: 5, retry_after_ms: 2500 } })).toEqual({
      retryAfterMs: 2500,
    })
    expect(statusPollRateLimit({ status: 429, details: { retry_after: 5, retry_after_ms: 'oops' } })).toEqual({
      retryAfterMs: 5000,
    })
  })

  it('非法值与非正值视为未给出：0、负数、NaN 一律回落到固定退避', () => {
    expect(statusPollRateLimit({ status: 429, details: { retry_after: 0 } })).toEqual({ retryAfterMs: null })
    expect(statusPollRateLimit({ status: 429, details: { retry_after_ms: 0 } })).toEqual({ retryAfterMs: null })
    expect(statusPollRateLimit({ status: 429, details: { retry_after: -1, retry_after_ms: -1 } })).toEqual({
      retryAfterMs: null,
    })
    expect(statusPollRateLimit({ status: 429, details: { retry_after: 'later' } })).toEqual({ retryAfterMs: null })
  })
})

describe('限流退避序列（60s 起步、连续限流翻倍、300s 封顶、服务端更长的要求优先）', () => {
  it('退避量级与依据一致：起点不低于 1 分钟，上限与 5 分钟惩罚窗口同量级', () => {
    expect(STATUS_POLL_RATE_LIMIT_MIN_MS).toBe(60000)
    expect(STATUS_POLL_RATE_LIMIT_MAX_MS).toBe(300000)
  })

  it('首次限流从 60s 起，连续限流按 60s→120s→240s→300s 翻倍并封顶', () => {
    let delay = nextStatusPollRateLimitDelayMs(0, null)
    const sequence = [delay]
    for (let round = 0; round < 5; round += 1) {
      delay = nextStatusPollRateLimitDelayMs(delay, null)
      sequence.push(delay)
    }
    expect(sequence).toEqual([60000, 120000, 240000, 300000, 300000, 300000])
  })

  it('服务端明确要求更长等待时以服务端为准，不被 300s 上限压制', () => {
    expect(nextStatusPollRateLimitDelayMs(240000, 900000)).toBe(900000)
    expect(nextStatusPollRateLimitDelayMs(0, 300000)).toBe(300000)
  })

  it('服务端要求比自动增长短时不缩短节奏：仍按自动增长推进', () => {
    expect(nextStatusPollRateLimitDelayMs(0, 1000)).toBe(60000)
    expect(nextStatusPollRateLimitDelayMs(60000, 1000)).toBe(120000)
  })

  it('一直限流就一直等待，不放弃轮询（不会退化为 0 或未定义）', () => {
    let delay = nextStatusPollRateLimitDelayMs(0, null)
    for (let round = 0; round < 20; round += 1) delay = nextStatusPollRateLimitDelayMs(delay, null)
    expect(delay).toBe(STATUS_POLL_RATE_LIMIT_MAX_MS)
    expect(Number.isFinite(delay)).toBe(true)
  })
})
