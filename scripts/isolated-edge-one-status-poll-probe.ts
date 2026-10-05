#!/usr/bin/env node
// EdgeOne 状态轮询策略：限流识别、退避序列与常规节奏（取值依据见 model/status-poll-policy.ts）
import assert from 'node:assert/strict'
import {
  STATUS_POLL_FIRST_MS,
  STATUS_POLL_MAX_MS,
  STATUS_POLL_RATE_LIMIT_MAX_MS,
  STATUS_POLL_RATE_LIMIT_MIN_MS,
  nextStatusPollDelayMs,
  nextStatusPollRateLimitDelayMs,
  statusPollRateLimit,
} from '../web/src/features/edge-one/model/status-poll-policy.js'

// 参数区间：起步 3s、稳态 10s 封顶（对齐 base-http.client.ts 的 MAX_RETRY_AFTER_MS）
assert.equal(STATUS_POLL_FIRST_MS, 3000)
assert.equal(STATUS_POLL_MAX_MS, 10000)
assert.ok(STATUS_POLL_RATE_LIMIT_MIN_MS >= 60000, '限流退避起点不得低于 1 分钟（后端单次调用最坏 20s）')
assert.ok(STATUS_POLL_RATE_LIMIT_MAX_MS >= STATUS_POLL_RATE_LIMIT_MIN_MS)

// 常规节奏：3s 起步线性 +1s 至 10s 后封顶
assert.equal(nextStatusPollDelayMs(STATUS_POLL_FIRST_MS), 4000)
assert.equal(nextStatusPollDelayMs(9000), 10000)
assert.equal(nextStatusPollDelayMs(10000), 10000)
assert.equal(nextStatusPollDelayMs(30000), STATUS_POLL_MAX_MS)

// 非限流失败：不得触发退避（普通网络错误、上游参数错误、真机遇到的 ResourceInUse/OperationDenied）
assert.equal(statusPollRateLimit(undefined), null)
assert.equal(statusPollRateLimit(new Error('boom')), null)
assert.equal(statusPollRateLimit({ code: 'http_error', status: 502 }), null)
assert.equal(
  statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { code: 'ResourceInUse' } }),
  null
)
assert.equal(
  statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { code: 'OperationDenied' } }),
  null
)

// 限流识别：HTTP 429 / provider_rate_limited / upstream_status=429 / 腾讯云业务限流码
assert.deepEqual(statusPollRateLimit({ status: 429 }), { retryAfterMs: null })
assert.deepEqual(statusPollRateLimit({ code: 'provider_rate_limited', status: 429 }), { retryAfterMs: null })
assert.deepEqual(
  statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { upstream_status: 429 } }),
  { retryAfterMs: null }
)
assert.deepEqual(
  statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { code: 'RequestLimitExceeded' } }),
  { retryAfterMs: null }
)
assert.deepEqual(
  statusPollRateLimit({ code: 'edgeone_request_failed', status: 502, details: { code: 'RequestLimitExceeded.Rate' } }),
  { retryAfterMs: null }
)

// 等待语义：retry_after 按秒、retry_after_ms 按毫秒，毫秒优先；非法值视为未给出
assert.deepEqual(statusPollRateLimit({ status: 429, details: { retry_after: 300 } }), { retryAfterMs: 300000 })
assert.deepEqual(statusPollRateLimit({ status: 429, details: { retry_after_ms: 2500 } }), { retryAfterMs: 2500 })
assert.deepEqual(statusPollRateLimit({ status: 429, details: { retry_after: 5, retry_after_ms: 2500 } }), {
  retryAfterMs: 2500,
})
assert.deepEqual(statusPollRateLimit({ status: 429, details: { retry_after: 0 } }), { retryAfterMs: null })

// 限流退避：60s 起步、连续限流翻倍、300s 封顶；服务端要求更长时以服务端为准
assert.equal(nextStatusPollRateLimitDelayMs(0, null), 60000)
assert.equal(nextStatusPollRateLimitDelayMs(60000, null), 120000)
assert.equal(nextStatusPollRateLimitDelayMs(120000, null), 240000)
assert.equal(nextStatusPollRateLimitDelayMs(240000, null), 300000)
assert.equal(nextStatusPollRateLimitDelayMs(300000, null), 300000)
assert.equal(nextStatusPollRateLimitDelayMs(0, 1000), 60000, '服务端等待过短时也必须显著延长，不能比原节奏更密')
assert.equal(nextStatusPollRateLimitDelayMs(0, 300000), 300000)
assert.equal(nextStatusPollRateLimitDelayMs(240000, 900000), 900000, '上限只封顶自动增长，不压制服务端明确要求')

console.log('edge-one-status-poll-probe=ok rate-limit=429/RequestLimitExceeded backoff=60s->300s')
