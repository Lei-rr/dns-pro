import { beforeEach, describe, expect, it } from 'vitest'
import { activeMemoryCache, installMemoryCache, MemoryCache } from '../../../core/cache/memory-cache.js'
import { installProviderCacheState } from '../../../core/cache/provider-cache.js'
import { ApiError } from '../../../core/http/api-error.js'
import type { CloudflareAccess } from '../access.js'
import { SaaSFallbackOriginClient, type FallbackOriginInfo } from './saas-fallback-origin.client.js'

/**
 * Cloudflare for SaaS 默认回源（Fallback Origin）客户端。
 *
 * 上游只有一条路径，但三种失败语义必须分开：404 = 未设置（返回空值并缓存）、
 * 其它 ApiError = 原样上抛、非 ApiError = 包装成 502。
 * 写路径的两个顺序细节是重点：缓存失效必须早于响应体解析（解析失败也要失效），
 * 而调用失败时不得动缓存（旧快照仍是最新已知状态）。
 */

const KEY = 'cloudflare:fallback_origin:cf-1:zone-1'
const PATH = 'zones/zone-1/custom_hostnames/fallback_origin'

type Upstream = {
  get?: (path: string) => Promise<unknown>
  put?: (path: string, body: unknown) => Promise<unknown>
  delete?: (path: string) => Promise<unknown>
}

/** 假上游：只桩 client 的三个方法，调用顺序记入 calls */
function clientWith(upstream: Upstream, calls: string[]): SaaSFallbackOriginClient {
  return new SaaSFallbackOriginClient({
    forProvider: async (providerId: string) => {
      calls.push(`forProvider:${providerId}`)
      return {
        client: {
          get: async (path: string) => {
            calls.push(`get:${path}`)
            if (!upstream.get) throw new Error('get 未配置')
            return upstream.get(path)
          },
          put: async (path: string, body: unknown) => {
            calls.push(`put:${path}:${JSON.stringify(body)}`)
            if (!upstream.put) throw new Error('put 未配置')
            return upstream.put(path, body)
          },
          delete: async (path: string) => {
            calls.push(`delete:${path}`)
            if (!upstream.delete) throw new Error('delete 未配置')
            return upstream.delete(path)
          },
        },
      }
    },
  } as unknown as CloudflareAccess)
}

async function captured(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('预期拒绝但未拒绝')
}

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

describe('show：缓存语义与「未设置」判定', () => {
  it('正常响应解析回源与状态，并写入站点级缓存键', async () => {
    const calls: string[] = []
    const client = clientWith(
      { get: async () => ({ result: { origin: 'origin.example.com', status: 'active' } }) },
      calls
    )

    await expect(client.show('cf-1', 'zone-1')).resolves.toEqual({ origin: 'origin.example.com', status: 'active' })
    expect(calls).toEqual(['forProvider:cf-1', `get:${PATH}`])
    expect(activeMemoryCache().get(KEY)).toEqual({ origin: 'origin.example.com', status: 'active' })
  })

  it('第二次读取命中缓存，不再请求上游', async () => {
    const calls: string[] = []
    const client = clientWith({ get: async () => ({ result: { origin: 'origin.example.com' } }) }, calls)

    await client.show('cf-1', 'zone-1')
    await expect(client.show('cf-1', 'zone-1')).resolves.toEqual({ origin: 'origin.example.com', status: null })
    expect(calls.filter((call) => call.startsWith('get:'))).toEqual([`get:${PATH}`])
  })

  it('refresh 绕过缓存重新请求并覆盖旧值', async () => {
    const calls: string[] = []
    let origin = 'old.example.com'
    const client = clientWith({ get: async () => ({ result: { origin } }) }, calls)

    expect(await client.show('cf-1', 'zone-1')).toEqual({ origin: 'old.example.com', status: null })
    origin = 'new.example.com'
    expect(await client.show('cf-1', 'zone-1')).toEqual({ origin: 'old.example.com', status: null })
    expect(await client.show('cf-1', 'zone-1', true)).toEqual({ origin: 'new.example.com', status: null })
    expect(calls.filter((call) => call.startsWith('get:'))).toEqual([`get:${PATH}`, `get:${PATH}`])
  })

  it('上游 404 视为「未设置」：返回空值，且空结果同样被缓存', async () => {
    const calls: string[] = []
    const notSet = new ApiError('http_error', 'Provider API error: 404 Not Found', 400, { upstream_status: 404 })
    const client = clientWith(
      {
        get: async () => {
          throw notSet
        },
      },
      calls
    )

    expect(await client.show('cf-1', 'zone-1')).toEqual({ origin: null, status: null })
    expect(await client.show('cf-1', 'zone-1')).toEqual({ origin: null, status: null })
    expect(calls.filter((call) => call.startsWith('get:'))).toEqual([`get:${PATH}`])
    expect(activeMemoryCache().get(KEY)).toEqual({ origin: null, status: null })
  })

  it('上游其它 ApiError 原样上抛，且不写缓存', async () => {
    const failure = new ApiError('cloudflare_zone_not_found', 'Cloudflare zone not found', 404)
    const calls: string[] = []
    const client = clientWith(
      {
        get: async () => {
          throw failure
        },
      },
      calls
    )

    await expect(client.show('cf-1', 'zone-1')).rejects.toBe(failure)
    expect(activeMemoryCache().get(KEY)).toBeUndefined()
  })

  it('上游非 ApiError 失败包装为 saas_fallback_origin_show_failed 502', async () => {
    const client = clientWith(
      {
        get: async () => {
          throw new Error('socket hang up')
        },
      },
      []
    )

    const error = await captured(() => client.show('cf-1', 'zone-1'))
    expect(error).toMatchObject({
      code: 'saas_fallback_origin_show_failed',
      statusCode: 502,
      message: 'Cloudflare fallback origin fetch failed',
      details: { zone: 'zone-1', provider_id: 'cf-1', error: 'socket hang up' },
    })
  })

  it('取客户端失败不在包装范围内：原样上抛（access 层错误不套 show_failed）', async () => {
    const failure = new ApiError('cloudflare_provider_not_found', 'Cloudflare provider not found', 404)
    const client = new SaaSFallbackOriginClient({
      forProvider: async () => {
        throw failure
      },
    } as unknown as CloudflareAccess)

    await expect(client.show('cf-1', 'zone-1')).rejects.toBe(failure)
    expect(activeMemoryCache().get(KEY)).toBeUndefined()
  })

  it.each([
    ['result 为空对象', { result: {} }],
    ['缺少 result', {}],
    ['result 是数组', { result: [] }],
    ['result 是字符串', { result: 'origin.example.com' }],
  ] as Array<[string, unknown]>)(
    '上游响应体非法（%s）抛 cloudflare_invalid_response 且不缓存',
    async (_label, payload) => {
      const client = clientWith({ get: async () => payload }, [])

      const error = await captured(() => client.show('cf-1', 'zone-1'))
      expect(error).toMatchObject({ code: 'cloudflare_invalid_response', statusCode: 502 })
      expect(activeMemoryCache().get(KEY)).toBeUndefined()
    }
  )

  it.each([
    [
      'origin 去首尾空白、status 原样',
      { origin: '  origin.example.com  ', status: 'active' },
      { origin: 'origin.example.com', status: 'active' },
    ],
    ['空 origin 归 null，空 status 保持空串', { origin: '', status: '' }, { origin: null, status: '' }],
    ['缺 origin 归 null，缺 status 归 null', { status: 'pending' }, { origin: null, status: 'pending' }],
    ['数字 origin 视为字符串，null status 归 null', { origin: 12345, status: null }, { origin: '12345', status: null }],
  ] as Array<[string, Record<string, unknown>, FallbackOriginInfo]>)(
    '响应字段归一（%s）',
    async (_label, result, expected) => {
      const client = clientWith({ get: async () => ({ result }) }, [])
      await expect(client.show('cf-1', 'zone-1')).resolves.toEqual(expected)
    }
  )

  it('并发未命中只触发一次上游加载（在途去重）', async () => {
    const calls: string[] = []
    let release: (value: unknown) => void = () => {}
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const client = clientWith({ get: async () => gate }, calls)

    const first = client.show('cf-1', 'zone-1')
    const second = client.show('cf-1', 'zone-1')
    release({ result: { origin: 'origin.example.com' } })

    await expect(first).resolves.toEqual({ origin: 'origin.example.com', status: null })
    await expect(second).resolves.toEqual({ origin: 'origin.example.com', status: null })
    expect(calls).toEqual(['forProvider:cf-1', `get:${PATH}`])
  })
})

describe('set：写后失效，且失效先于响应体解析', () => {
  it('PUT 提交 origin 并返回上游结果，写后缓存失效', async () => {
    const calls: string[] = []
    const client = clientWith(
      {
        get: async () => ({ result: { origin: 'old.example.com', status: 'active' } }),
        put: async () => ({ result: { origin: 'new.example.com', status: 'active' } }),
      },
      calls
    )

    await client.show('cf-1', 'zone-1')
    expect(activeMemoryCache().get(KEY)).toEqual({ origin: 'old.example.com', status: 'active' })

    await expect(client.set('cf-1', 'zone-1', 'new.example.com')).resolves.toEqual({
      origin: 'new.example.com',
      status: 'active',
    })
    expect(calls).toEqual([
      'forProvider:cf-1',
      `get:${PATH}`,
      'forProvider:cf-1',
      `put:${PATH}:{"origin":"new.example.com"}`,
    ])
    expect(activeMemoryCache().get(KEY)).toBeUndefined()
  })

  it('响应体无法解析时也已失效缓存（先失效再解析）', async () => {
    const calls: string[] = []
    const client = clientWith(
      { get: async () => ({ result: { origin: 'old.example.com' } }), put: async () => ({}) },
      calls
    )

    await client.show('cf-1', 'zone-1')
    await expect(client.set('cf-1', 'zone-1', 'new.example.com')).rejects.toMatchObject({
      code: 'cloudflare_invalid_response',
      statusCode: 502,
    })
    expect(activeMemoryCache().get(KEY)).toBeUndefined()
  })

  it('上游失败包装为 saas_fallback_origin_set_failed，且不动缓存', async () => {
    const calls: string[] = []
    const client = clientWith(
      {
        get: async () => ({ result: { origin: 'old.example.com' } }),
        put: async () => {
          throw new Error('upstream 500')
        },
      },
      calls
    )

    await client.show('cf-1', 'zone-1')
    const error = await captured(() => client.set('cf-1', 'zone-1', 'new.example.com'))

    expect(error).toMatchObject({
      code: 'saas_fallback_origin_set_failed',
      statusCode: 502,
      message: 'Cloudflare fallback origin update failed',
      details: { zone: 'zone-1', provider_id: 'cf-1', error: 'upstream 500' },
    })
    expect(activeMemoryCache().get(KEY)).toEqual({ origin: 'old.example.com', status: null })
  })

  it('上游 ApiError 原样上抛，不被二次包装', async () => {
    const failure = new ApiError('cloudflare_connection_failed', 'Cloudflare connection failed', 502)
    const client = clientWith(
      {
        put: async () => {
          throw failure
        },
      },
      []
    )

    await expect(client.set('cf-1', 'zone-1', 'new.example.com')).rejects.toBe(failure)
  })
})

describe('delete：写后失效', () => {
  it('DELETE 成功后返回空值并失效缓存', async () => {
    const calls: string[] = []
    const client = clientWith(
      {
        get: async () => ({ result: { origin: 'old.example.com' } }),
        delete: async () => ({ result: { id: 'z-1' } }),
      },
      calls
    )

    await client.show('cf-1', 'zone-1')
    await expect(client.delete('cf-1', 'zone-1')).resolves.toEqual({ origin: null, status: null })
    expect(calls).toEqual(['forProvider:cf-1', `get:${PATH}`, 'forProvider:cf-1', `delete:${PATH}`])
    expect(activeMemoryCache().get(KEY)).toBeUndefined()
  })

  it('上游失败包装为 saas_fallback_origin_delete_failed，且不动缓存', async () => {
    const calls: string[] = []
    const client = clientWith(
      {
        get: async () => ({ result: { origin: 'old.example.com' } }),
        delete: async () => {
          throw new Error('upstream 500')
        },
      },
      calls
    )

    await client.show('cf-1', 'zone-1')
    const error = await captured(() => client.delete('cf-1', 'zone-1'))

    expect(error).toMatchObject({
      code: 'saas_fallback_origin_delete_failed',
      statusCode: 502,
      message: 'Cloudflare fallback origin delete failed',
      details: { zone: 'zone-1', provider_id: 'cf-1', error: 'upstream 500' },
    })
    expect(activeMemoryCache().get(KEY)).toEqual({ origin: 'old.example.com', status: null })
  })
})

describe('路径构造', () => {
  it('站点 ID 经 URL 编码后拼进路径（斜杠与空格不改变路径结构）', async () => {
    const calls: string[] = []
    const client = clientWith({ get: async () => ({ result: { origin: 'origin.example.com' } }) }, calls)

    await client.show('cf-1', 'z 1/2')
    expect(calls).toEqual(['forProvider:cf-1', 'get:zones/z%201%2F2/custom_hostnames/fallback_origin'])
  })
})
