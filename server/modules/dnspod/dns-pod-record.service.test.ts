import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installMemoryCache, MemoryCache } from '../../core/cache/memory-cache.js'
import { installProviderCacheState, providerCacheStats } from '../../core/cache/provider-cache.js'
import { toAsciiFqdn } from '../../shared/values.js'
import { DnsPodClient } from './dns-pod.client.js'
import { DnsPodRecordService } from './dns-pod-record.service.js'
import { DnsPodZoneService } from './dns-pod-zone.service.js'

/**
 * 迁移自 scripts/isolated-cache-probe.ts 的 DNSPod IDN 部分（P1：契约类，客户端用原型桩，无网络）。
 * UI 路径（Unicode）与同步路径（punycode）必须落到同一条记录缓存；
 * 站点删除的失效标签也要覆盖该缓存（归一只改匹配侧时两处都会漏）。
 */

const originalCall = DnsPodClient.prototype.call

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

afterEach(() => {
  DnsPodClient.prototype.call = originalCall
})

describe('DNSPod IDN 缓存键同源', () => {
  it('Unicode 与 punycode 命中同一条记录缓存；站点删除的失效标签覆盖 punycode 记录缓存', async () => {
    const providers = { requireType: async () => ({ secret_id: 'sid', secret_key: 'skey' }) }
    let recordLists = 0
    DnsPodClient.prototype.call = async function (action: string): Promise<Record<string, unknown>> {
      if (action === 'DescribeRecordList') {
        recordLists += 1
        return { RecordList: [], RecordCountInfo: { TotalCount: 0 }, RequestId: 'idn' }
      }
      if (action === 'DeleteDomain') return { RequestId: 'deleted' }
      throw new Error(`unexpected DNSPod action: ${action}`)
    }

    const records = new DnsPodRecordService(providers as never)
    const zones = new DnsPodZoneService(providers as never)
    const idn = '例子.中国'
    const ascii = toAsciiFqdn(idn)
    expect(ascii).not.toBe(idn)

    await records.list('p1', idn)
    await records.list('p1', ascii)
    expect(recordLists).toBe(1)
    expect(providerCacheStats().size).toBe(1)

    await zones.delete('p1', idn)
    expect(providerCacheStats().size).toBe(0)
  })
})
