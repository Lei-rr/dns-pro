import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMemoryCache, MemoryCache } from '../../core/cache/memory-cache.js'
import { installProviderCacheState } from '../../core/cache/provider-cache.js'
import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import { TencentCloudClient } from '../../core/providers/tencent-cloud.client.js'
import type { DnsPodZoneService } from './dns-pod-zone.service.js'
import { DnsPodLineService } from './dns-pod-line.service.js'

/**
 * 线路结果随域名套餐等级变化：点刷新线路时必须把 refresh 透传到套餐等级来源（站点列表），
 * 否则会按旧 grade 请求上游，并把结果以新的 5 分钟 TTL 再固定一次。
 */

const providers = {
  requireType: async () => ({ id: 'dns-1', type: 'dnspod', secret_id: 'secret-id', secret_key: 'secret-key' }),
} as unknown as ProviderRepository

const callSpy = vi.spyOn(TencentCloudClient.prototype, 'call')

function zoneServiceStub(grade: string) {
  const calls: Array<{ providerId: string; filters: { refresh?: boolean } }> = []
  const service = {
    list: async (providerId: string, filters: { refresh?: boolean } = {}) => {
      calls.push({ providerId, filters })
      return grade === '' ? { items: [] } : { items: [{ name: 'example.com', punycode: 'example.com', grade }] }
    },
  } as unknown as DnsPodZoneService
  return { service, calls }
}

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
  callSpy.mockReset()
  callSpy.mockResolvedValue({
    LineList: [
      { Name: '默认', LineId: '0' },
      { Name: '', LineId: '9' },
    ],
    LineGroupList: [{ Name: '境内', LineId: '1' }],
    RequestId: 'req-1',
  })
})

afterEach(() => {
  callSpy.mockReset()
})

describe('DnsPodLineService.lines：refresh 透传到套餐等级', () => {
  it('refresh=true 时站点列表也按 refresh 读取，并按新 grade 请求线路', async () => {
    const { service, calls } = zoneServiceStub('DP_Free')
    const lines = new DnsPodLineService(providers, service)

    const result = await lines.lines('dns-1', 'Example.COM.', true)

    expect(calls).toEqual([{ providerId: 'dns-1', filters: { refresh: true } }])
    expect(callSpy).toHaveBeenCalledWith('DescribeRecordLineList', {
      Domain: 'example.com',
      DomainGrade: 'DP_Free',
    })
    expect(result.items).toEqual([{ name: '默认', line_id: '0' }])
    expect(result.groups).toEqual([{ name: '境内', line_id: '1' }])
    expect(result.request_id).toBe('req-1')
  })

  it('默认读取不透传 refresh，grade 取不到时交给上游判断', async () => {
    const { service, calls } = zoneServiceStub('')
    const lines = new DnsPodLineService(providers, service)

    await lines.lines('dns-1', 'example.com')

    expect(calls).toEqual([{ providerId: 'dns-1', filters: { refresh: false } }])
    expect(callSpy).toHaveBeenCalledWith('DescribeRecordLineList', {
      Domain: 'example.com',
      DomainGrade: undefined,
    })
  })
})
