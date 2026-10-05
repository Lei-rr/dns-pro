import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeMemoryCache, installMemoryCache, MemoryCache } from '../../core/cache/memory-cache.js'
import {
  installProviderCacheState,
  recordCacheTag,
  recordLineCacheTag,
  zoneCacheTag,
} from '../../core/cache/provider-cache.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import { TencentCloudClient } from '../../core/providers/tencent-cloud.client.js'
import { DNSPOD_PROVIDER_TYPE } from './dns-pod.cache.js'
import { DnsPodZoneService } from './dns-pod-zone.service.js'

/**
 * 站点变更的缓存失效必须排在响应体解析之前：
 * 上游已受理但响应体无法解析（502）时，若解析先抛错，站点列表仍返回变更前快照，
 * 新建域名不可见、已删域名仍被当成写入目标，直到 TTL 过期。
 */

const providers = {
  requireType: async () => ({ id: 'dns-1', type: 'dnspod', secret_id: 'secret-id', secret_key: 'secret-key' }),
} as unknown as ProviderRepository

const callSpy = vi.spyOn(TencentCloudClient.prototype, 'call')

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
  callSpy.mockReset()
})

afterEach(() => {
  callSpy.mockReset()
})

function seedCaches() {
  activeMemoryCache().set('probe:dnspod:zones', { items: [] }, [zoneCacheTag(DNSPOD_PROVIDER_TYPE, 'dns-1')])
  activeMemoryCache().set('probe:dnspod:records', { records: [] }, [
    recordCacheTag(DNSPOD_PROVIDER_TYPE, 'dns-1', 'example.com'),
  ])
  activeMemoryCache().set('probe:dnspod:lines', { items: [] }, [
    recordLineCacheTag(DNSPOD_PROVIDER_TYPE, 'dns-1', 'example.com'),
  ])
}

function expectCachesCleared() {
  expect(activeMemoryCache().get('probe:dnspod:zones')).toBeUndefined()
  expect(activeMemoryCache().get('probe:dnspod:records')).toBeUndefined()
  expect(activeMemoryCache().get('probe:dnspod:lines')).toBeUndefined()
}

describe('DNSPod 站点 create：先失效再解析', () => {
  it('正常响应返回域名信息，并把域名归一为 punycode 后失效缓存', async () => {
    callSpy.mockResolvedValue({
      DomainInfo: { Id: 123, Domain: 'example.com', GradeNsList: ['ns1.example.com'] },
      RequestId: 'req-1',
    })
    seedCaches()

    const zone = await new DnsPodZoneService(providers).create('dns-1', 'Example.COM.')

    expect(zone).toEqual({ id: 123, name: 'example.com', name_servers: ['ns1.example.com'], request_id: 'req-1' })
    expect(callSpy).toHaveBeenCalledWith('CreateDomain', { Domain: 'example.com' })
    expectCachesCleared()
  })

  it('响应体无法解析（502）时缓存也已失效', async () => {
    callSpy.mockResolvedValue({})
    seedCaches()

    await expect(new DnsPodZoneService(providers).create('dns-1', 'example.com')).rejects.toMatchObject({
      code: 'dnspod_invalid_response',
    })
    expectCachesCleared()
  })
})

describe('DNSPod 站点 delete：先失效再解析', () => {
  it('响应体无法解析（502）时缓存也已失效', async () => {
    callSpy.mockResolvedValue({})
    seedCaches()

    await expect(new DnsPodZoneService(providers).delete('dns-1', 'example.com')).rejects.toMatchObject({
      code: 'dnspod_invalid_response',
    })
    expectCachesCleared()
  })

  it('正常响应返回域名与 RequestId', async () => {
    callSpy.mockResolvedValue({ RequestId: 'req-2' })
    seedCaches()

    await expect(new DnsPodZoneService(providers).delete('dns-1', 'example.com')).resolves.toEqual({
      name: 'example.com',
      request_id: 'req-2',
    })
    expectCachesCleared()
  })
})
