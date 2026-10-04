#!/usr/bin/env node
// 上游限流重试与任务快照体积守卫
import assert from 'node:assert/strict'
import { JobService } from '../server/src/kernel/jobs/job.service.js'
import { ApiError } from '../server/src/kernel/http/api-error.js'
import { BaseHttpClient } from '../server/src/kernel/http/base-http.client.js'
import { TencentCloudClient } from '../server/src/kernel/providers/tencent-cloud.client.js'

// 直接暴露受保护的 request
class ProbeClient extends BaseHttpClient {
  constructor() {
    super({ baseURL: 'https://provider.test/client/v4' })
  }
  call(method: string): Promise<unknown> {
    return this.request({ method, url: 'zones/z/dns_records' })
  }
}

type Reply = { status: number; headers?: Record<string, string>; body?: string }
const originalFetch = globalThis.fetch

async function withFetch(replies: Reply[], task: (calls: number[]) => Promise<void>) {
  const calls: number[] = []
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const index = calls.length
    calls.push(index)
    const reply = replies[Math.min(index, replies.length - 1)] as Reply
    return new Response(reply.body ?? '{"ok":true}', {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    })
  }) as unknown as typeof fetch
  try {
    await task(calls)
  } finally {
    globalThis.fetch = originalFetch
  }
}

const client = new ProbeClient()

// 1. 429 + Retry-After=0：POST 也会重试，且遵循上游等待时间
await withFetch([{ status: 429, headers: { 'retry-after': '0' } }, { status: 200 }], async (calls) => {
  await client.call('POST')
  assert.equal(calls.length, 2, '限流（429）应按任何方法重试')
})

// 2. Retry-After 超过上限：快速失败，不长时间占用请求
await withFetch([{ status: 429, headers: { 'retry-after': '120' } }], async (calls) => {
  await assert.rejects(
    client.call('GET'),
    (error: unknown) => error instanceof ApiError && error.code === 'provider_rate_limited'
  )
  assert.equal(calls.length, 1, '上游要求的等待过长时不应立刻重试')
})

// 3. 5xx：幂等方法重试，非幂等方法不重试（避免重复执行）
await withFetch([{ status: 500 }, { status: 500 }, { status: 500 }], async (calls) => {
  await assert.rejects(client.call('GET'))
  assert.equal(calls.length, 3, 'GET 应重试 5xx')
})
await withFetch([{ status: 500 }], async (calls) => {
  await assert.rejects(client.call('POST'))
  assert.equal(calls.length, 1, 'POST 不应重试 5xx')
})

// 4. 腾讯云业务错误码限流（HTTP 200 + Error.Code）：同样重试
const tencent = new TencentCloudClient(
  { secretId: 'id', secretKey: 'key' },
  {
    endpoint: 'dnspod.tencentcloudapi.com',
    service: 'dnspod',
    version: '2021-03-23',
    errorCode: 'dnspod_request_failed',
    errorPrefix: 'DNSPod',
  }
)
let tencentCalls = 0
globalThis.fetch = (async () => {
  tencentCalls++
  if (tencentCalls === 1) {
    return new Response(
      JSON.stringify({
        Response: { Error: { Code: 'RequestLimitExceeded', Message: 'rate limited' }, RequestId: 'r' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  return new Response(JSON.stringify({ Response: { RequestId: 'r' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}) as unknown as typeof fetch
try {
  await tencent.call('DescribeRecordList', {})
  assert.equal(tencentCalls, 2, '腾讯云业务限流错误应重试')
} finally {
  globalThis.fetch = originalFetch
}

// 5. 任务记录：已完成任务剥离执行期快照，失败任务保留快照供重试
const jobs = new JobService()
const bigSnapshot = { type: 'CNAME', name: 'a.example.com', value: 'x'.repeat(4096), purpose: 'origin_cname' }
const created = await jobs.create(
  'size.probe',
  {},
  [
    {
      hostname: 'a.example.com',
      status: 'pending',
      dns_before_records: [bigSnapshot],
      cleanup_recipe: { hostname_fqdn: 'a.example.com', records: [bigSnapshot] },
    },
  ],
  { start: false }
)
await jobs.patch(created.id, { status: 'completed', finished_at: Date.now() })

const completedItem = (await jobs.get(created.id))?.items[0] ?? {}
assert.equal('dns_before_records' in completedItem, false, '已完成任务不应保留 DNS 快照')
assert.equal('cleanup_recipe' in completedItem, false, '已完成任务不应保留清理配方')
assert.equal(completedItem.hostname, 'a.example.com', '完成任务的展示字段必须保留')

// 失败任务保留快照，重试才能恢复更新前状态
const failed = await jobs.create('size.probe', {}, [{ hostname: 'b.example.com', status: 'pending' }], {
  start: false,
})
await jobs.patchItem(failed.id, () => true, { status: 'failed', dns_before_records: [bigSnapshot] })
await jobs.patch(failed.id, { status: 'failed', finished_at: Date.now() })
const failedItem = (await jobs.get(failed.id))?.items[0] ?? {}
assert.ok(Array.isArray(failedItem.dns_before_records), '失败任务必须保留快照供重试')

console.log('provider-retry-probe=ok ratelimit=honored backoff=bounded snapshots=trimmed')
