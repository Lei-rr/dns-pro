import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installMemoryCache, MemoryCache } from '../../../core/cache/memory-cache.js'
import { installProviderCacheState } from '../../../core/cache/provider-cache.js'
import { SaaSCustomHostnameClient } from './saas-custom-hostname.client.js'

/**
 * 多站点查找的上游用量：批量入口（hostnameIndex）只从缓存取一次快照，未命中不追加刷新请求。
 * 「未命中即强制刷新确认」只留给单次查找入口（idByHostname）——写路径需要它，遍历站点不需要：
 * 每个未命中站点各刷新一次会让请求量随站点数放大（refresh 还跳过缓存读与在途去重）。
 */

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

type PageFixture = Array<Record<string, unknown>>

/** 假上游：按站点注册分页数据，记录每次列表请求的路径与页码 */
function clientWith(pages: Record<string, PageFixture[]>, calls: string[]): SaaSCustomHostnameClient {
  return new SaaSCustomHostnameClient({
    forProvider: async () => ({
      client: {
        get: async (path: string, params: Record<string, unknown>) => {
          const page = Number(params.page ?? 1)
          calls.push(`${path}#page=${page}`)
          const zoneId = decodeURIComponent(path.split('/')[1] ?? '')
          const zonePages = pages[zoneId] ?? []
          return {
            result: zonePages[page - 1] ?? [],
            result_info: { page, per_page: 100, total_count: zonePages.length, total_pages: zonePages.length },
          }
        },
      },
    }),
  } as never)
}

describe('SaaS 主机名索引快照：一次拉取、多次匹配', () => {
  it('查 N 个站点只按站点各拉一次列表，不为未命中追加刷新重拉', async () => {
    const calls: string[] = []
    const client = clientWith(
      {
        'zone-1': [[{ id: 'h-1', hostname: 'a.example.com' }]],
        'zone-2': [[{ id: 'h-2', hostname: 'b.example.com' }]],
        'zone-3': [[{ id: 'h-3', hostname: 'c.example.com' }]],
      },
      calls
    )

    for (const zoneId of ['zone-1', 'zone-2', 'zone-3']) {
      // 与 service 的多站点遍历同形：取快照 → 在快照内匹配
      expect((await client.hostnameIndex('cf-1', zoneId)).findId('target.example.net')).toBeUndefined()
    }

    // 修复前每个未命中站点会走「缓存查找 + 强制刷新查找」两遍（共 6 次）；现在每站点恰好 1 次
    expect(calls).toEqual([
      'zones/zone-1/custom_hostnames#page=1',
      'zones/zone-2/custom_hostnames#page=1',
      'zones/zone-3/custom_hostnames#page=1',
    ])
  })

  it('同一站点的后续匹配命中快照缓存，不再产生上游请求；FQDN 大小写与尾点归一', async () => {
    const calls: string[] = []
    const client = clientWith({ 'zone-1': [[{ id: 'h-1', hostname: 'www.example.com' }]] }, calls)

    expect((await client.hostnameIndex('cf-1', 'zone-1')).findId('WWW.Example.com.')).toBe('h-1')
    expect((await client.hostnameIndex('cf-1', 'zone-1')).findId('www.example.com')).toBe('h-1')
    expect(calls.length).toBe(1)
  })

  it('未命中时：批量入口只问一次快照，单次查找入口才刷新确认', async () => {
    const calls: string[] = []
    const client = clientWith({ 'zone-1': [[{ id: 'h-1', hostname: 'www.example.com' }]] }, calls)

    expect((await client.hostnameIndex('cf-1', 'zone-1')).findId('missing.example.com')).toBeUndefined()
    expect((await client.hostnameIndex('cf-1', 'zone-1')).findId('missing.example.com')).toBeUndefined()
    expect(calls.length).toBe(1)

    // 单次查找：缓存快照未命中 → 强制刷新确认一次 → 仍没有才 404
    await expect(client.idByHostname('cf-1', 'zone-1', 'missing.example.com')).rejects.toMatchObject({
      code: 'saas_hostname_not_found',
      statusCode: 404,
    })
    expect(calls.length).toBe(2)
  })

  it('单次查找命中时不刷新：命中快照即返回 ID', async () => {
    const calls: string[] = []
    const client = clientWith({ 'zone-1': [[{ id: 'h-1', hostname: 'www.example.com' }]] }, calls)

    expect(await client.idByHostname('cf-1', 'zone-1', 'www.example.com')).toBe('h-1')
    expect(calls.length).toBe(1)
  })
})

/** 写路径的 payload 构造：这两处曾经把上游 400 的成因留给用户去猜 */
const createdHostname = { result: { id: 'h-1', hostname: 'a.example.com', ssl: { status: 'pending_validation' } } }

function postSpy() {
  return vi.fn(async (_path: string, _body: Record<string, unknown>) => createdHostname)
}

function clientWithPost(post: ReturnType<typeof postSpy>): SaaSCustomHostnameClient {
  return new SaaSCustomHostnameClient({
    forProvider: async () => ({ client: { post } }),
  } as never)
}

describe('自定义主机名写路径的 payload', () => {
  it('缺 method 时兜底 http，避免上游 1434 The SSL attribute is invalid', async () => {
    const post = postSpy()
    await clientWithPost(post).create('cf-1', 'zone-1', { hostname: 'a.example.com' })
    expect(post.mock.calls[0]?.[1]).toMatchObject({ ssl: { type: 'dv', method: 'http' } })
  })

  it('显式 method 覆盖兜底值', async () => {
    const post = postSpy()
    await clientWithPost(post).create('cf-1', 'zone-1', { hostname: 'a.example.com', method: 'txt' })
    expect(post.mock.calls[0]?.[1]).toMatchObject({ ssl: { type: 'dv', method: 'txt' } })
  })

  it('自定义回源削平协议、端口与路径后再送上游', async () => {
    const post = postSpy()
    await clientWithPost(post).create('cf-1', 'zone-1', {
      hostname: 'a.example.com',
      custom_origin_server: 'https://origin.example.com:8443/app',
    })
    expect(post.mock.calls[0]?.[1]).toMatchObject({ custom_origin_server: 'origin.example.com' })
  })

  it('自定义回源不是合法主机名时报明确错误，不打上游', async () => {
    const post = postSpy()
    await expect(
      clientWithPost(post).create('cf-1', 'zone-1', { hostname: 'a.example.com', custom_origin_server: '1.2.3.4' })
    ).rejects.toMatchObject({ code: 'saas_invalid_origin_server', statusCode: 400 })
    expect(post).not.toHaveBeenCalled()
  })
})
