import { beforeEach, describe, expect, it } from 'vitest'
import { activeMemoryCache, installMemoryCache, MemoryCache } from '../../core/cache/memory-cache.js'
import { installProviderCacheState, recordCacheTag, zoneCacheTag } from '../../core/cache/provider-cache.js'
import type { CloudflareAccess } from './access.js'
import { CLOUDFLARE_PROVIDER_TYPE } from './cloudflare.cache.js'
import { CloudflareZoneService } from './cloudflare-zone.service.js'

/**
 * 站点变更的缓存失效必须排在响应体解析之前：
 * 上游已受理但响应体无法解析（502）时，若解析先抛错，站点列表会继续返回变更前快照——
 * 新建站点不可见、已删站点仍被当成写入目标，直到 TTL 过期。
 */

type FakeClient = {
  get(path: string, params?: Record<string, unknown>): Promise<unknown>
  post(path: string, body?: unknown): Promise<unknown>
  delete(path: string): Promise<unknown>
}

function serviceWith(client: Partial<FakeClient>): CloudflareZoneService {
  const access = {
    forProvider: async () => ({
      provider: { id: 'cf-1', type: 'cloudflare', account_id: 'acct' },
      accountId: 'acct',
      client,
    }),
  } as unknown as CloudflareAccess
  return new CloudflareZoneService(access)
}

const zoneTag = () => zoneCacheTag(CLOUDFLARE_PROVIDER_TYPE, 'cf-1')

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

describe('Cloudflare 站点 create：先失效再解析', () => {
  it('正常响应返回站点，且站点缓存已失效', async () => {
    const key = 'probe:cloudflare:zones:ok'
    activeMemoryCache().set(key, { items: [] }, [zoneTag()])
    const service = serviceWith({ post: async () => ({ result: { id: 'z-1', name: 'example.com' } }) })

    const zone = await service.create('cf-1', 'example.com')

    expect(zone.id).toBe('z-1')
    expect(activeMemoryCache().get(key)).toBeUndefined()
  })

  it('响应体无法解析（502）时缓存也已失效', async () => {
    const key = 'probe:cloudflare:zones:broken'
    activeMemoryCache().set(key, { items: [] }, [zoneTag()])
    const service = serviceWith({ post: async () => ({}) })

    await expect(service.create('cf-1', 'example.com')).rejects.toMatchObject({
      code: 'cloudflare_invalid_response',
    })
    expect(activeMemoryCache().get(key)).toBeUndefined()
  })
})

describe('Cloudflare 站点 delete：先失效再解析', () => {
  it('响应体无法解析（502）时站点与记录缓存均已失效', async () => {
    const zoneKey = 'probe:cloudflare:zones:delete'
    const recordKey = 'probe:cloudflare:records:delete'
    activeMemoryCache().set(zoneKey, { items: [] }, [zoneTag()])
    activeMemoryCache().set(recordKey, { records: [] }, [recordCacheTag(CLOUDFLARE_PROVIDER_TYPE, 'cf-1', 'z-1')])
    const service = serviceWith({ delete: async () => ({}) })

    await expect(service.delete('cf-1', 'z-1')).rejects.toMatchObject({
      code: 'cloudflare_invalid_response',
    })
    expect(activeMemoryCache().get(zoneKey)).toBeUndefined()
    expect(activeMemoryCache().get(recordKey)).toBeUndefined()
  })

  it('正常响应返回站点 ID，并失效站点与记录缓存', async () => {
    const zoneKey = 'probe:cloudflare:zones:delete-ok'
    const recordKey = 'probe:cloudflare:records:delete-ok'
    activeMemoryCache().set(zoneKey, { items: [] }, [zoneTag()])
    activeMemoryCache().set(recordKey, { records: [] }, [recordCacheTag(CLOUDFLARE_PROVIDER_TYPE, 'cf-1', 'z-1')])
    const service = serviceWith({ delete: async () => ({ result: { id: 'z-1' } }) })

    await expect(service.delete('cf-1', 'z-1')).resolves.toEqual({ id: 'z-1' })
    expect(activeMemoryCache().get(zoneKey)).toBeUndefined()
    expect(activeMemoryCache().get(recordKey)).toBeUndefined()
  })
})

/** 迁移自 scripts/isolated-saas-config-branch-probe.ts 第 2 节：idByName 的真实调用链 */
describe('Cloudflare 站点 idByName：上游过滤、翻页与未命中', () => {
  it('站点名按归一化形态过滤上游、命中即止、第二页命中继续翻页、全量未命中显式 404', async () => {
    const requests: Array<Record<string, unknown>> = []
    const pages = new Map<number, unknown[]>([
      [1, [{ id: 'zone-www', name: 'WWW.example.com', status: 'active', type: 'full' }]],
      [2, [{ id: 'zone-other', name: 'other.example.com', status: 'active', type: 'full' }]],
    ])
    let totalPages = 3
    const service = serviceWith({
      get: async (path: string, params: Record<string, unknown> = {}) => {
        expect(path).toBe('zones')
        requests.push(params)
        const page = Number(params.page ?? 1)
        return {
          success: true,
          result: pages.get(page) ?? [],
          result_info: { page, per_page: Number(params.per_page ?? 50), total_pages: totalPages },
        }
      },
    })

    // 大小写/尾点差异不算未命中；命中后不得继续翻页，上游过滤值必须是归一化站点名
    await expect(service.idByName('cf-1', '  WWW.Example.COM. ')).resolves.toBe('zone-www')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.name).toBe('www.example.com')

    // 命中在第二页：必须继续翻页
    requests.length = 0
    pages.set(1, [{ id: 'zone-aaa', name: 'aaa.example.com', status: 'active', type: 'full' }])
    await expect(service.idByName('cf-1', 'other.example.com', true)).resolves.toBe('zone-other')
    expect(requests.map((params) => params.page)).toEqual([1, 2])

    // 全量扫描后仍未命中：必须显式 404，不得把「找不到」当成空站点 ID
    pages.set(1, [])
    pages.set(2, [])
    totalPages = 1
    await expect(service.idByName('cf-1', 'missing.example.com', true)).rejects.toMatchObject({
      code: 'cloudflare_zone_not_found',
      statusCode: 404,
    })
  })
})
