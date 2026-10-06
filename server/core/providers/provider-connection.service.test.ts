import { describe, expect, it } from 'vitest'
import { ApiError } from '../http/api-error.js'
import { ProviderConnectionService } from './provider-connection.service.js'
import type { ProviderRepository } from './provider.repository.js'
import type { Provider } from './provider.types.js'

/**
 * 关联链校验：类型不匹配与引用环都必须在发起连通性探测之前被拒，
 * 否则一次「测试连接」会把请求打到与声明类型不符的服务商上。
 * 正向控制同样必要：合法 SaaS → Cloudflare 关联必须真的探测一次，
 * 否则「一律拒绝」也能让上面的断言通过，等于没验证。
 */

function buildService() {
  const linkedProviders = new Map<string, Provider>([
    ['saas-a', { id: 'saas-a', type: 'saas', name: 'SaaS A', cloudflare_provider: 'cf-b' } as Provider],
    ['cf-b', { id: 'cf-b', type: 'cloudflare', name: 'CF B' } as Provider],
    ['dnspod-c', { id: 'dnspod-c', type: 'dnspod', name: 'DNS C' } as Provider],
    ['saas-d', { id: 'saas-d', type: 'saas', name: 'SaaS D', cloudflare_provider: 'dnspod-c' } as Provider],
  ])
  let probeCalls = 0
  const probes = {
    dnspodZones: {
      list: async () => {
        probeCalls++
        return { items: [] }
      },
    },
    cloudflareZones: {
      page: async () => {
        probeCalls++
        return { items: [], totalCount: 0 }
      },
    },
    edgeoneZones: {
      zones: async () => {
        probeCalls++
        return { items: [] }
      },
    },
    tunnels: {
      list: async () => {
        probeCalls++
        return { items: [] }
      },
    },
  }
  const connections = new ProviderConnectionService(
    { find: async (id: string) => linkedProviders.get(id) } as unknown as ProviderRepository,
    probes
  )
  return { connections, probeCount: () => probeCalls }
}

async function captured(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error('预期拒绝但未拒绝')
}

describe('ProviderConnectionService：关联链校验先于探测', () => {
  it('关联类型不匹配 → 422，且不得发起连通性探测', async () => {
    const { connections, probeCount } = buildService()
    const before = probeCount()
    const error = await captured(() => connections.test('saas-d'))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'provider_reference_type_mismatch', statusCode: 422 })
    expect(probeCount()).toBe(before)
  })

  it('引用环守卫：visited 已含自身 → 422，并在 details.chain 给出链路', async () => {
    const { connections } = buildService()
    // 数据上不可能构环（关联目标类型 dnspod/cloudflare 均为终点），用公开的 visited 入参直接验证守卫
    const error = await captured(() => connections.test('saas-a', new Set(['saas-a'])))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'provider_reference_cycle', statusCode: 422 })
    const details = (error as ApiError).details as Record<string, unknown>
    // 链路内容必须是「已访问链 + 当前 id」：空数组（未给出链路）过不了
    expect(details.chain).toEqual(['saas-a', 'saas-a'])
  })

  it('正向控制：合法 SaaS → Cloudflare 关联必须探测一次并返回关联 ID', async () => {
    const { connections, probeCount } = buildService()
    const before = probeCount()
    const linked = await connections.test('saas-a')
    expect(linked.ok).toBe(true)
    expect(linked.type).toBe('saas')
    expect((linked.details as Record<string, unknown>).cloudflare_provider).toBe('cf-b')
    expect(probeCount()).toBe(before + 1)
  })
})
