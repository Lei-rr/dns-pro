import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareClient } from './cloudflare.client.js'

/**
 * Cloudflare v4 API 客户端（HTTP 层契约）。
 *
 * 这一层只做三件事：拼请求（baseURL + 路径 + 查询串 + JSON 体）、
 * 把上游业务错误（success:false）翻译成 cloudflare_request_failed、
 * 把「没有上游响应体」的网络层 502 折叠成 cloudflare_connection_failed。
 * fetch 全程是桩：断言 URL / 方法 / 头 / 体与每一类错误码，零真实网络。
 */

type FetchCall = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

/** 替换全局 fetch 并记录每次请求的构造结果 */
function installFetch(reply: (url: string, init: RequestInit) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method ?? ''),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    return reply(String(input), init ?? {})
  })
  return calls
}

const jsonResponse = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } })

async function captured(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('预期拒绝但未拒绝')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('请求构造：URL / 方法 / 头 / 体', () => {
  it('forProvider：token 去空白，Bearer / Accept / Content-Type 一次装配', async () => {
    const calls = installFetch(() => jsonResponse({ success: true, result: [] }))

    await CloudflareClient.forProvider({ api_token: '  secret-token  ' }).get('zones')

    expect(calls).toEqual([
      {
        url: 'https://api.cloudflare.com/client/v4/zones',
        method: 'GET',
        headers: {
          Authorization: 'Bearer secret-token',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: undefined,
      },
    ])
  })

  it('get：params 拼进查询串，null / undefined / 空串不发送', async () => {
    const calls = installFetch(() => jsonResponse({ success: true, result: [] }))

    await new CloudflareClient('token').get('zones/z-1/dns_records', {
      page: 2,
      per_page: 50,
      type: 'CNAME',
      name: '',
      missing: undefined,
      none: null,
    })

    expect(calls).toEqual([
      {
        url: 'https://api.cloudflare.com/client/v4/zones/z-1/dns_records?page=2&per_page=50&type=CNAME',
        method: 'GET',
        headers: { Authorization: 'Bearer token', Accept: 'application/json', 'Content-Type': 'application/json' },
        body: undefined,
      },
    ])
  })

  it('post：对象体 JSON 序列化后发送', async () => {
    const body = { type: 'CNAME', name: 'www', content: 'target.example.net', ttl: 1 }
    const calls = installFetch(() => jsonResponse({ success: true, result: { id: 'r-1' } }))

    await new CloudflareClient('token').post('zones/z-1/dns_records', body)

    expect(calls).toEqual([
      {
        url: 'https://api.cloudflare.com/client/v4/zones/z-1/dns_records',
        method: 'POST',
        headers: { Authorization: 'Bearer token', Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ])
  })

  it('put / patch / delete 各用对应方法，delete 不带请求体', async () => {
    const calls = installFetch(() => jsonResponse({ success: true, result: { id: 'r-1' } }))
    const client = new CloudflareClient('token')

    await client.put('zones/z-1/dns_records/r-1', { content: 'a.example.net' })
    await client.patch('zones/z-1/dns_records/r-1', { ttl: 60 })
    await client.delete('zones/z-1/dns_records/r-1')

    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['PUT', 'https://api.cloudflare.com/client/v4/zones/z-1/dns_records/r-1', '{"content":"a.example.net"}'],
      ['PATCH', 'https://api.cloudflare.com/client/v4/zones/z-1/dns_records/r-1', '{"ttl":60}'],
      ['DELETE', 'https://api.cloudflare.com/client/v4/zones/z-1/dns_records/r-1', undefined],
    ])
  })

  it('路径逃逸在发请求前被拒：invalid_upstream_path，零网络调用', async () => {
    const calls = installFetch(() => jsonResponse({ success: true }))

    const error = await captured(() => new CloudflareClient('token').get('zones/../..'))

    expect(error).toMatchObject({ code: 'invalid_upstream_path', statusCode: 400 })
    expect(calls).toEqual([])
  })
})

describe('成功响应形态：不臆造字段，也不吞掉非 JSON 文本', () => {
  it('缺 success 字段时照常返回整个响应体（含 result_info）', async () => {
    const payload = { result: { id: 'z-1', name: 'example.com' }, result_info: { page: 1, total_pages: 1 } }
    installFetch(() => jsonResponse(payload))

    await expect(new CloudflareClient('token').get('zones')).resolves.toEqual(payload)
  })

  it('上游返回非 JSON 文本时按无效响应拒绝，不冒充 API 响应对象', async () => {
    // 网关 / 代理会直接吐 HTML：BaseHttpClient 此时把原始文本当字符串返回，
    // client 门面必须拒绝——否则调用方读 .result 恒为 undefined 却不报错，故障被显示成空数据
    installFetch(
      () => new Response('<html>gateway error</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    )

    const error = await captured(() => new CloudflareClient('token').get('zones'))

    expect(error).toMatchObject({
      code: 'cloudflare_invalid_response',
      statusCode: 502,
      details: { upstream_body: '<html>gateway error</html>' },
    })
  })

  it('上游返回 JSON 数组时同样拒绝（数组不是 API 响应对象）', async () => {
    installFetch(() => jsonResponse([1, 2, 3]))

    const error = await captured(() => new CloudflareClient('token').get('zones'))

    expect(error).toMatchObject({ code: 'cloudflare_invalid_response', statusCode: 502 })
  })

  it('上游返回空响应体时归一为空对象', async () => {
    installFetch(() => new Response('', { status: 200 }))

    await expect(new CloudflareClient('token').delete('zones/z-1')).resolves.toEqual({})
  })
})

describe('上游业务错误：success:false 一律 502', () => {
  it('消息带第一条错误，details 保留原始 errors 数组', async () => {
    const errors = [
      { code: 10000, message: 'Invalid API Token' },
      { code: 10001, message: 'second error' },
    ]
    installFetch(() => jsonResponse({ success: false, errors, messages: [], result: null }))

    const error = await captured(() => new CloudflareClient('token').get('zones'))

    expect(error).toMatchObject({
      code: 'cloudflare_request_failed',
      statusCode: 502,
      message: 'Cloudflare request failed: Invalid API Token',
      details: { errors },
    })
  })

  it.each([
    ['errors 不是数组', { success: false, errors: 'rate limited' }],
    ['errors 为空数组', { success: false, errors: [] }],
    ['errors 缺失', { success: false }],
    ['第一条错误没有 message', { success: false, errors: [{ code: 10000 }] }],
  ] as Array<[string, Record<string, unknown>]>)('错误不可读（%s）时用兜底消息', async (_label, payload) => {
    installFetch(() => jsonResponse(payload))

    const error = await captured(() => new CloudflareClient('token').get('zones'))

    expect(error).toMatchObject({
      code: 'cloudflare_request_failed',
      statusCode: 502,
      message: 'Cloudflare request failed',
    })
  })
})

describe('非 2xx 与网络层：错误码不折叠、不误判', () => {
  it('上游 404 映射为 400 http_error，details 保留 upstream_status 与响应体', async () => {
    const calls = installFetch(() => jsonResponse({ success: false, errors: [{ code: 1049 }] }, 404))

    const error = await captured(() => new CloudflareClient('token').get('zones/z-missing'))

    expect(error).toMatchObject({
      code: 'http_error',
      statusCode: 400,
      details: { upstream_status: 404, upstream_body: { success: false, errors: [{ code: 1049 }] } },
    })
    expect(calls).toHaveLength(1)
  })

  it('上游 5xx（POST 非幂等）不重试，保留 upstream_status 而不折叠成连接失败', async () => {
    const calls = installFetch(() => jsonResponse({ success: false, errors: [] }, 503))

    const error = await captured(() => new CloudflareClient('token').post('zones', {}))

    expect(error).toMatchObject({ code: 'http_error', statusCode: 502, details: { upstream_status: 503 } })
    expect(calls).toHaveLength(1)
  })

  it('GET 5xx 用尽重试预算后仍是带 upstream_status 的 502', async () => {
    const calls = installFetch(() => jsonResponse({ success: false, errors: [] }, 500))

    const error = await captured(() => new CloudflareClient('token').get('zones'))

    expect(error).toMatchObject({ code: 'http_error', statusCode: 502, details: { upstream_status: 500 } })
    expect(calls).toHaveLength(3)
  })

  it('上游 401 归类为 provider_credentials_invalid（与参数错误区分）', async () => {
    installFetch(() => new Response('', { status: 401 }))

    const error = await captured(() => new CloudflareClient('token').post('zones', {}))

    expect(error).toMatchObject({
      code: 'provider_credentials_invalid',
      statusCode: 400,
      details: { upstream_status: 401, upstream_body: null },
    })
  })

  it('上游 429 且 Retry-After 超过上限时立即失败为 provider_rate_limited', async () => {
    const calls = installFetch(() => jsonResponse({ success: false, errors: [] }, 429, { 'retry-after': '120' }))

    const error = await captured(() => new CloudflareClient('token').post('zones', {}))

    expect(error).toMatchObject({
      code: 'provider_rate_limited',
      statusCode: 429,
      details: { upstream_status: 429, retry_after_ms: 120000 },
    })
    expect(calls).toHaveLength(1)
  })

  it('网络层异常归类为 cloudflare_connection_failed，details 带原始消息', async () => {
    installFetch(() => Promise.reject(new TypeError('fetch failed')))

    const error = await captured(() => new CloudflareClient('token').post('zones', {}))

    expect(error).toMatchObject({
      code: 'cloudflare_connection_failed',
      statusCode: 502,
      message: 'Cloudflare connection failed',
      details: { original_error: 'Provider API request failed: fetch failed' },
    })
  })

  it('请求超时（AbortSignal 触发）同样归类为 cloudflare_connection_failed', async () => {
    const calls = installFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
          )
        })
    )

    const error = await captured(() => new CloudflareClient('token', 10).delete('zones/z-1'))

    expect(error).toMatchObject({
      code: 'cloudflare_connection_failed',
      statusCode: 502,
      details: { original_error: 'Provider API request timed out after 10ms' },
    })
    expect(calls).toHaveLength(1)
  })
})
