import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCache } from './memory-cache.js'

/**
 * 迁移自 scripts/isolated-cache-probe.ts 的 MemoryCache 部分（P1：纯内存，无 IO）。
 */

afterEach(() => {
  vi.useRealTimers()
})

describe('MemoryCache 存活时间（惰性过期）', () => {
  it('过期后按未命中处理，并在读取时清除条目', () => {
    vi.useFakeTimers()
    const cache = new MemoryCache({ ttlMs: 30 })
    cache.set('k', { value: 1 })
    expect(cache.get('k')).toEqual({ value: 1 })
    vi.advanceTimersByTime(45)
    expect(cache.get('k')).toBeUndefined()
    expect(cache.stats().size).toBe(0)
  })
})

describe('MemoryCache 容量上限（LRU 淘汰）', () => {
  it('超出上限淘汰最久未使用条目，访问过的条目保留', () => {
    const cache = new MemoryCache({ ttlMs: 60_000, maxEntries: 3 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBe(1)
    cache.set('d', 4)
    expect(cache.stats().size).toBe(3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('d')).toBe(4)
  })
})

describe('MemoryCache 标签失效', () => {
  it('命中标签的条目被删除，其余保留', () => {
    const cache = new MemoryCache({ ttlMs: 60_000 })
    cache.set('x', 1, ['provider:p1', 'cf:records'])
    cache.set('y', 2, ['provider:p2'])
    cache.invalidateTags(['provider:p1'])
    expect(cache.get('x')).toBeUndefined()
    expect(cache.get('y')).toBe(2)
  })
})

describe('默认上限（防止无上限增长）', () => {
  it('未显式配置上限时写入远超上限的条目，size 收敛为有限值', () => {
    const cache = new MemoryCache({ ttlMs: 60_000 })
    for (let index = 0; index < 1000; index += 1) cache.set(`bulk:${index}`, index)
    const bounded = cache.stats().size
    expect(bounded).toBeGreaterThan(0)
    expect(bounded, '默认上限必须挡住无上限增长').toBeLessThan(1000)
    // 已达上限：继续写入不再增长（默认上限不导出，只能以行为观察）
    for (let index = 1000; index < 1200; index += 1) cache.set(`bulk:${index}`, index)
    expect(cache.stats().size).toBe(bounded)
  })
})
