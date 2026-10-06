import { beforeEach, describe, expect, it } from 'vitest'
import { installMemoryCache, MemoryCache } from '../../core/cache/memory-cache.js'
import { installProviderCacheState } from '../../core/cache/provider-cache.js'
import { CloudflareDnsRecordService } from './cloudflare-dns-record.service.js'

/**
 * 迁移自 scripts/isolated-cache-probe.ts 的 Cloudflare 分页缓存键部分（P1：契约类，无真实网络）。
 * B8：键缺了 type/name 过滤会让不同过滤互相命中（读串）。
 */

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

type PageCall = {
  page(
    providerId: string,
    zoneId: string,
    page: number,
    perPage: number,
    filters: { type?: string; name?: string }
  ): Promise<unknown>
}

function serviceWith(calls: string[]): CloudflareDnsRecordService {
  return new CloudflareDnsRecordService({
    forProvider: async () => ({
      client: {
        get: async (path: string, params: Record<string, unknown>) => {
          calls.push(`${path}?${JSON.stringify(params)}`)
          return { result: [], result_info: { page: 1, per_page: 100, total_count: 0, total_pages: 1 } }
        },
      },
    }),
  } as never)
}

describe('加速域名分页缓存键', () => {
  it('相同过滤命中同一条缓存；不同 name / type / 分页不得互相命中', async () => {
    const calls: string[] = []
    const service = serviceWith(calls)
    // 带过滤的整页查询只在本服务内部使用：私有方法直取以覆盖真实缓存键
    const page = (service as unknown as PageCall).page
    expect(typeof page).toBe('function')

    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A', name: 'a.example.com' })
    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A', name: 'a.example.com' })
    expect(calls.length).toBe(1)

    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A', name: 'b.example.com' })
    expect(calls.length).toBe(2)
    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'AAAA', name: 'a.example.com' })
    expect(calls.length).toBe(3)
    await page.call(service, 'cf-1', 'zone-1', 2, 100, { type: 'A', name: 'a.example.com' })
    expect(calls.length).toBe(4)
  })

  it('键归一：类型与名称大小写同键；带不带 name、类型、分页必须区分', async () => {
    const calls: string[] = []
    const service = serviceWith(calls)
    const page = (service as unknown as PageCall).page

    // 键函数已收进模块内部，归一化按行为断言：等价写法不得产生第二次上游调用
    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: ' a ', name: 'A.Example.com' })
    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A', name: 'a.example.com' })
    expect(calls.length).toBe(1)

    // 带不带 name、不同 type、不同分页必须各自独立，绝不能互相命中
    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'A' })
    expect(calls.length).toBe(2)
    await page.call(service, 'cf-1', 'zone-1', 1, 100, { type: 'TXT' })
    expect(calls.length).toBe(3)
    await page.call(service, 'cf-1', 'zone-1', 2, 100, { type: 'A' })
    expect(calls.length).toBe(4)
  })
})
