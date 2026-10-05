import { afterEach, describe, expect, it, vi } from 'vitest'
import { TencentCloudClient } from './tencent-cloud.client.js'

/**
 * 迁移自 scripts/isolated-provider-retry-probe.ts 的腾讯云部分（P1：契约类，无真实网络）。
 * HTTP 200 + 业务错误码限流同样要重试（由 withRateLimitRetry 处理，不叠加 HTTP 层预算）。
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('腾讯云业务错误码限流', () => {
  it('HTTP 200 + RequestLimitExceeded：重试后成功，仅两次上游调用', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      if (calls === 1) {
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
    })

    const client = new TencentCloudClient(
      { secretId: 'id', secretKey: 'key' },
      {
        endpoint: 'dnspod.tencentcloudapi.com',
        service: 'dnspod',
        version: '2021-03-23',
        errorCode: 'dnspod_request_failed',
        errorPrefix: 'DNSPod',
      }
    )
    await client.call('DescribeRecordList', {})
    expect(calls).toBe(2)
  })
})
