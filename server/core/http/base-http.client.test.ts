import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api-error.js'
import { BaseHttpClient } from './base-http.client.js'

/**
 * 迁移自 scripts/isolated-provider-retry-probe.ts 的 HTTP 重试部分（P1：契约类，无真实网络）。
 * fetch 用预置响应替换，逐条搬移限流/退避断言。
 */

/** 直接暴露受保护的 request：与原探针一致，验证真实重试编排 */
class ProbeClient extends BaseHttpClient {
  constructor() {
    super({ baseURL: 'https://provider.test/client/v4' })
  }
  call(method: string): Promise<unknown> {
    return this.request({ method, url: 'zones/z/dns_records' })
  }
}

type Reply = { status: number; headers?: Record<string, string>; body?: string }

/** 按序返回预置响应并记录调用次数；用尽后重复最后一条 */
function withFetch(replies: Reply[]): number[] {
  const calls: number[] = []
  vi.stubGlobal('fetch', async (_url: string | URL | Request) => {
    const index = calls.length
    calls.push(index)
    const reply = replies[Math.min(index, replies.length - 1)] as Reply
    return new Response(reply.body ?? '{"ok":true}', {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const client = new ProbeClient()

describe('HTTP 限流重试：429 遵循上游等待时间', () => {
  it('429 + Retry-After=0：POST 也会重试', async () => {
    const calls = withFetch([{ status: 429, headers: { 'retry-after': '0' } }, { status: 200 }])
    await client.call('POST')
    expect(calls.length).toBe(2)
  })

  it('Retry-After 超过上限：快速失败为 provider_rate_limited，不立刻重试', async () => {
    const calls = withFetch([{ status: 429, headers: { 'retry-after': '120' } }])
    const error = await client.call('GET').then(
      () => null,
      (reason: unknown) => reason
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'provider_rate_limited' })
    expect(calls.length).toBe(1)
  })
})

describe('5xx 重试只限幂等方法', () => {
  it('GET 重试 5xx 直到重试预算用尽', async () => {
    const calls = withFetch([{ status: 500 }, { status: 500 }, { status: 500 }])
    await client.call('GET').catch(() => undefined)
    expect(calls.length).toBe(3)
  })

  it('POST 不重试 5xx（避免非幂等请求被重复执行）', async () => {
    const calls = withFetch([{ status: 500 }])
    await client.call('POST').catch(() => undefined)
    expect(calls.length).toBe(1)
  })
})
