import { afterEach, describe, expect, it } from 'vitest'
import { queryClient } from './client'

/**
 * 全局 queryClient 是读路径的唯一原语：fetch / 复用 / invalidate 都必须经过它。
 * 迁移自 scripts/isolated-job-progress-probe.ts（探针已退役）。
 * 单例跨用例共享缓存，用例结束清理，避免污染其它测试。
 */

const probeKey = ['vitest', 'query-client', 'resource']

afterEach(() => {
  queryClient.removeQueries()
})

describe('全局 queryClient', () => {
  it('fresh 缓存条目直接复用；invalidate 后强制重新获取', async () => {
    let fetches = 0

    const first = await queryClient.fetchQuery({
      queryKey: probeKey,
      queryFn: async () => {
        fetches++
        return 'cached'
      },
    })
    expect(first).toBe('cached')
    expect(queryClient.getQueryData(probeKey)).toBe('cached')

    const second = await queryClient.fetchQuery({
      queryKey: probeKey,
      queryFn: async () => {
        fetches++
        return 'stale'
      },
    })
    // staleTime 内的 fresh 缓存条目不得被重新获取
    expect(second).toBe('cached')
    expect(fetches).toBe(1)

    await queryClient.invalidateQueries({ queryKey: probeKey })
    const refreshed = await queryClient.fetchQuery({
      queryKey: probeKey,
      queryFn: async () => {
        fetches++
        return 'fresh'
      },
    })
    // invalidate 必须让下一次读取真正打到 queryFn
    expect(refreshed).toBe('fresh')
    expect(fetches).toBe(2)
  })
})
