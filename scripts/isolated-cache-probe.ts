#!/usr/bin/env node
// 缓存语义：存活时间、容量上限、标签失效与在途加载拦截
import assert from 'node:assert/strict'
import { MemoryCache, CACHE_MAX_ENTRIES, CACHE_TTL_MS } from '../server/core/cache/memory-cache.js'
import { invalidateProviderCache, providerCacheStats, withProviderCache } from '../server/core/cache/provider-cache.js'
import {
  CloudflareDnsRecordService,
  cloudflareRecordPageKey,
} from '../server/modules/cloudflare/cloudflare-dns-record.service.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 1. 存活时间：过期后按未命中处理并删除
{
  const cache = new MemoryCache({ ttlMs: 30 })
  cache.set('k', { value: 1 })
  assert.deepEqual(cache.get('k'), { value: 1 }, '未过期应命中')
  await sleep(45)
  assert.equal(cache.get('k'), undefined, '过期后必须视为未命中')
  assert.equal(cache.stats().size, 0, '过期条目应在读取时被清除')
}

// 2. 容量上限：超出后淘汰最久未使用的条目
{
  const cache = new MemoryCache({ ttlMs: 60_000, maxEntries: 3 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)
  assert.equal(cache.get('a'), 1, '访问 a 使其变为最近使用')
  cache.set('d', 4)
  assert.equal(cache.stats().size, 3, '容量必须受限')
  assert.equal(cache.get('b'), undefined, '最久未使用的 b 应被淘汰')
  assert.equal(cache.get('a'), 1, '最近使用的 a 必须保留')
  assert.equal(cache.get('d'), 4)
}

// 3. 标签失效：命中标签的条目被删除，其余保留
{
  const cache = new MemoryCache({ ttlMs: 60_000 })
  cache.set('x', 1, ['provider:p1', 'cf:records'])
  cache.set('y', 2, ['provider:p2'])
  cache.invalidateTags(['provider:p1'])
  assert.equal(cache.get('x'), undefined)
  assert.equal(cache.get('y'), 2)
}

// 4. 默认上限存在且为合理值（防止无上限增长）
assert.ok(CACHE_MAX_ENTRIES > 0 && CACHE_TTL_MS > 0)
assert.deepEqual(Object.keys(providerCacheStats()), ['size'], '健康检查契约保持 { size }')

// 5. provider-cache：命中不重复加载；refresh 绕过并覆盖；标签失效后重新加载
{
  let loads = 0
  const loader = async () => {
    loads++
    return { loads }
  }
  const key = { prefix: 'probe:cache', parts: { provider_id: 'p1', zone: 'z' } }
  const tags = ['provider:p1', 'probe:cache-tag']

  const first = await withProviderCache({ key, tags, loader })
  assert.equal(first.hit, false)
  const second = await withProviderCache({ key, tags, loader })
  assert.equal(second.hit, true, '第二次读取应命中缓存')
  assert.equal(loads, 1)

  const refreshed = await withProviderCache({ key, tags, loader, refresh: true })
  assert.equal(refreshed.hit, false)
  assert.equal(loads, 2, 'refresh 必须绕过缓存')

  invalidateProviderCache({ tags })
  const afterInvalidate = await withProviderCache({ key, tags, loader })
  assert.equal(afterInvalidate.hit, false, '标签失效后必须重新加载')
  assert.equal(loads, 3)
}

// 6. 在途加载去重：并发读只加载一次
{
  let loads = 0
  const loader = async () => {
    loads++
    await sleep(30)
    return { loads }
  }
  const key = 'probe:cache:inflight'
  const tags = ['probe:inflight-tag']
  invalidateProviderCache({ tags })
  const [a, b] = await Promise.all([withProviderCache({ key, tags, loader }), withProviderCache({ key, tags, loader })])
  assert.equal(loads, 1, '并发冷读必须合并为一次上游加载')
  assert.equal(a.value.loads, b.value.loads)
}

// 7. Cloudflare 记录分页缓存键必须含 type/name 过滤（B8：缺了它们不同过滤会互相命中）
{
  const calls: string[] = []
  const service = new CloudflareDnsRecordService({
    forProvider: async () => ({
      client: {
        get: async (path: string, params: Record<string, unknown>) => {
          calls.push(`${path}?${JSON.stringify(params)}`)
          return { result: [], result_info: { page: 1, per_page: 100, total_count: 0, total_pages: 1 } }
        },
      },
    }),
  } as never)
  // 带过滤的整页查询目前只在本服务内部使用：私有方法直取以覆盖真实缓存键（listAll 不带过滤）
  const page = (
    service as unknown as {
      page(
        providerId: string,
        zoneId: string,
        page: number,
        perPage: number,
        filters: { type?: string; name?: string }
      ): Promise<unknown>
    }
  ).page
  assert.equal(typeof page, 'function', 'Cloudflare 记录分页查询缺失')

  await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A', name: 'a.example.com' })
  await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A', name: 'a.example.com' })
  assert.equal(calls.length, 1, '相同过滤必须命中同一条缓存')

  await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A', name: 'b.example.com' })
  assert.equal(calls.length, 2, '不同 name 过滤不得互相命中')
  await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'AAAA', name: 'a.example.com' })
  assert.equal(calls.length, 3, '不同 type 过滤不得互相命中')
  await page.call(service, 'cf-1', 'zone-1', 2, 100, { type: 'A', name: 'a.example.com' })
  assert.equal(calls.length, 4, '不同分页不得互相命中')

  const key = (filters: { type?: string; name?: string }, pageNo = 1) =>
    cloudflareRecordPageKey('cf-1', 'zone-1', pageNo, 100, filters)
  assert.equal(
    key({ type: ' a ', name: 'A.Example.com' }),
    key({ type: 'A', name: 'a.example.com' }),
    '类型大小写与名称大小写必须归一到同一条缓存'
  )
  assert.notEqual(key({ type: 'A', name: 'a.example.com' }), key({ type: 'A' }), '带不带 name 过滤必须区分')
  assert.notEqual(key({ type: 'A' }), key({ type: 'TXT' }), '类型过滤必须进键')
  assert.notEqual(key({ type: 'A' }, 2), key({ type: 'A' }, 1), '分页必须进键')
}

console.log('cache-probe=ok ttl=expires lru=evicts tags=invalidate inflight=deduped records-key=filtered')
