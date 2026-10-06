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
    expect(first.value).toEqual({ loads: 1 })
    const second = await withProviderCache({ key, tags, loader })
    expect(second.value).toEqual({ loads: 1 })
    expect(loads, '第二次读取必须命中缓存，不再回源').toBe(1)

    const refreshed = await withProviderCache({ key, tags, loader, refresh: true })
    expect(refreshed.value).toEqual({ loads: 2 })
    expect(loads, 'refresh 必须绕过缓存回源').toBe(2)

    invalidateProviderCache({ tags })
    const afterInvalidate = await withProviderCache({ key, tags, loader })
    expect(afterInvalidate.value).toEqual({ loads: 3 })
    expect(loads, '标签失效后必须重新回源').toBe(3)
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

/** 手动放行的在途加载：验证失败重试、失效栅栏与 refresh 绕过在途的时序 */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('withProviderCache：失败重试与失效栅栏', () => {
  it('并发失败只调用一次 loader，失败后不留单飞条目、可立即重试', async () => {
    const key = 'probe:failed-single-flight'
    let loads = 0
    const failure = new Error('expected cache loader failure')
    const failedLoad = () =>
      withProviderCache({
        key,
        loader: async () => {
          loads++
          throw failure
        },
      })
    const results = await Promise.allSettled([failedLoad(), failedLoad()])
    expect(loads).toBe(1)
    expect(results.every((result) => result.status === 'rejected' && result.reason === failure)).toBe(true)
    const retried = await withProviderCache({ key, loader: async () => ++loads })
    expect(retried.value).toBe(2)
  })

  it('失效栅栏：在途结果被拦截不回填，失效后的调用不并入陈旧在途', async () => {
    const key = 'probe:invalidation-fence'
    const tag = 'probe:fence'
    const staleRelease = deferred<string>()
    let loads = 0
    const staleRead = withProviderCache({
      key,
      tags: [tag],
      loader: async () => {
        loads++
        return staleRelease.promise
      },
    })
    invalidateProviderCache({ tags: [tag] })
    const freshRead = withProviderCache({
      key,
      tags: [tag],
      loader: async () => {
        loads++
        return 'fresh'
      },
    })
    staleRelease.resolve('stale')
    expect((await staleRead).value).toBe('stale')
    expect((await freshRead).value).toBe('fresh')
    // 失效之后不允许旧的在途结果补写缓存：这里的 loader 说明不应再被执行
    const afterInvalidation = await withProviderCache({ key, tags: [tag], loader: async () => 'must-not-run' })
    expect(afterInvalidation.value).toBe('fresh')
    expect(loads).toBe(2)
  })

  it('显式 refresh 不与冷在途合并', async () => {
    const key = 'probe:refresh-bypass'
    const coldRelease = deferred<string>()
    let loads = 0
    const coldRead = withProviderCache({
      key,
      loader: async () => {
        loads++
        return coldRelease.promise
      },
    })
    const refreshed = await withProviderCache({
      key,
      refresh: true,
      loader: async () => {
        loads++
        return 'refreshed'
      },
    })
    coldRelease.resolve('cold')
    await coldRead
    expect(refreshed.value).toBe('refreshed')
    expect(loads).toBe(2)
  })
})
