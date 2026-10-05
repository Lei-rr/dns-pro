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
