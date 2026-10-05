import { beforeEach, describe, expect, it } from 'vitest'
import { installMemoryCache, MemoryCache } from './memory-cache.js'
import {
  installProviderCacheState,
  invalidateProviderCache,
  providerCacheStats,
  withProviderCache,
} from './provider-cache.js'

/**
 * 迁移自 scripts/isolated-cache-probe.ts 的 provider-cache 部分（P1：纯内存，无 IO）。
 * 进程级实例在装配期安装，这里每个用例前换成干净实例，与探针的隔离方式一致。
 */

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('withProviderCache：命中、refresh 与标签失效', () => {
  it('第二次读取命中缓存；refresh 绕过并覆盖；标签失效后重新加载', async () => {
    let loads = 0
    const loader = async () => {
      loads++
      return { loads }
    }
    const key = { prefix: 'probe:cache', parts: { provider_id: 'p1', zone: 'z' } }
    const tags = ['provider:p1', 'probe:cache-tag']

    const first = await withProviderCache({ key, tags, loader })
    expect(first.hit).toBe(false)
    const second = await withProviderCache({ key, tags, loader })
    expect(second.hit).toBe(true)
    expect(loads).toBe(1)

    const refreshed = await withProviderCache({ key, tags, loader, refresh: true })
    expect(refreshed.hit).toBe(false)
    expect(loads).toBe(2)

    invalidateProviderCache({ tags })
    const afterInvalidate = await withProviderCache({ key, tags, loader })
    expect(afterInvalidate.hit).toBe(false)
    expect(loads).toBe(3)
  })
})

describe('withProviderCache：在途加载去重', () => {
  it('并发冷读合并为一次上游加载', async () => {
    let loads = 0
    const loader = async () => {
      loads++
      await sleep(30)
      return { loads }
    }
    const key = 'probe:cache:inflight'
    const tags = ['probe:inflight-tag']
    invalidateProviderCache({ tags })

    const [a, b] = await Promise.all([
      withProviderCache({ key, tags, loader }),
      withProviderCache({ key, tags, loader }),
    ])
    expect(loads).toBe(1)
    expect(a.value.loads).toBe(b.value.loads)
  })
})

describe('健康检查契约', () => {
  it('providerCacheStats 只暴露 { size }', () => {
    expect(Object.keys(providerCacheStats())).toEqual(['size'])
  })
})
