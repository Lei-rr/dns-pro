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

/** 直接暴露受保护的 request：与探针一致，验证路径守卫与上游错误映射 */
class PathProbeClient extends BaseHttpClient {
  constructor() {
    super({ baseURL: 'https://provider.invalid' })
  }
  callWith(url: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.request({ url, params })
  }
}

async function captured(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('预期拒绝但未拒绝')
}

/**
 * 上游路径逃逸：记录 ID / 站点名拼进 URL 路径后，`.`/`..`/`%2e` 段与空段必须在发请求前被拒；
 * 编码后的分隔符（%2f / %5c）与「解码后才是 ..」的组合同样要拒——上游可能对路径二次解码。
 */
const escapedPaths = [
  '..',
  '../zones',
  'zones/..',
  '%2e%2e',
  '%2E%2E/zones',
  'a//b',
  'https://evil.invalid/',
  'zones/a%2fb',
  'zones/a%5Cb',
  '%2e%2fzones',
  'zones/%2e%2e%2f%2e%2e',
]

describe('上游路径守卫与上游错误映射', () => {
  it('上游 404 映射为 400，且 details.upstream_status 保留 404', async () => {
    withFetch([{ status: 404, body: '{"error":"missing"}' }])
    const error = (await captured(() => new PathProbeClient().callWith('resource'))) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.statusCode).toBe(400)
    expect(error.details as Record<string, unknown>).toMatchObject({ upstream_status: 404 })
  })

  it.each(escapedPaths)('拒绝逃逸路径：%s', async (escaped) => {
    withFetch([{ status: 404 }])
    const error = (await captured(() => new PathProbeClient().callWith(escaped))) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('invalid_upstream_path')
  })

  it.each(['zones/zone-1', 'zones/zone.1', 'zones/ab%20cd'])('合法路径不得被误判为逃逸：%s', async (allowed) => {
    withFetch([{ status: 404 }])
    const error = (await captured(() => new PathProbeClient().callWith(allowed))) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).not.toBe('invalid_upstream_path')
    expect(error.details as Record<string, unknown>).toMatchObject({ upstream_status: 404 })
  })
})
