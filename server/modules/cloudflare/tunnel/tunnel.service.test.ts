import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activeMemoryCache, installMemoryCache, MemoryCache } from '../../../core/cache/memory-cache.js'
import {
  cloudflaredTunnelConfigCacheTag,
  cloudflaredTunnelsCacheTag,
  installProviderCacheState,
} from '../../../core/cache/provider-cache.js'
import { ApiError } from '../../../core/http/api-error.js'
import type { CloudflareAccess } from '../access.js'
import { TunnelService } from './tunnel.service.js'

/**
 * 隧道写路径的两处契约：
 * - rotateToken 先换密钥再取令牌，取令牌失败属于「部分成功」，不能 502（调用方重试会再换一次密钥）
 * - 删除时上游 404 与「连接已断开」同语义（视为目标状态已达成），且缓存失效必须照常执行
 */

type FakeClient = {
  get(path: string, params?: Record<string, unknown>): Promise<unknown>
  post(path: string, body?: unknown): Promise<unknown>
  patch(path: string, body?: unknown): Promise<unknown>
  delete(path: string): Promise<unknown>
}

function serviceWith(client: Partial<FakeClient>): TunnelService {
  const account = { provider: { id: 'cf-1' }, cloudflareProviderId: 'tun-1', accountId: 'acct', client }
  const access = { forTunnel: async () => account } as unknown as CloudflareAccess
  return new TunnelService(access)
}

/** base-http.client 折叠后的上游 404：状态码 400 + details.upstream_status=404 */
const upstreamNotFound = () =>
  new ApiError('http_error', 'Provider API error: 404 Not Found', 400, { upstream_status: 404 })
const upstreamServerError = () =>
  new ApiError('http_error', 'Provider API error: 500 Internal Server Error', 502, { upstream_status: 500 })

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

describe('rotateToken：部分成功必须对外可见', () => {
  it('密钥已换、令牌取回失败时返回 token=null 与失败副作用，不抛 502', async () => {
    const patch = vi.fn(async () => ({ result: { id: 'tid-1' } }))
    const get = vi.fn(async () => ({}))
    const service = serviceWith({ patch, get })

    const result = await service.rotateToken('tun-1', 'tid-1')

    expect(patch).toHaveBeenCalledTimes(1)
    expect(result.token).toBeNull()
    expect(result.side_effects?.tunnel?.token?.status).toBe('failed')
  })

  it('成功路径返回值保持既有形状（只有 token）', async () => {
    const patch = vi.fn(async () => ({ result: { id: 'tid-1' } }))
    const get = vi.fn(async () => ({ result: 'tok-rotated' }))
    const service = serviceWith({ patch, get })

    await expect(service.rotateToken('tun-1', 'tid-1')).resolves.toEqual({ token: 'tok-rotated' })
  })
})

describe('delete：404 归一与缓存失效', () => {
  it('隧道本体 404 视为已删除（幂等），并失效列表与路由缓存', async () => {
    const listKey = 'probe:cloudflared:tunnels'
    const routeKey = 'probe:cloudflared:tunnel:routes'
    activeMemoryCache().set(listKey, { items: [] }, [cloudflaredTunnelsCacheTag('tun-1')])
    activeMemoryCache().set(routeKey, { routes: [] }, [cloudflaredTunnelConfigCacheTag('tun-1', 'tid-1')])
    const client = {
      delete: vi.fn(async (path: string) => {
        if (path.endsWith('/connections')) throw upstreamNotFound()
        throw upstreamNotFound()
      }),
    }
    const service = serviceWith(client)

    await expect(service.delete('tun-1', 'tid-1')).resolves.toEqual({ id: 'tid-1' })
    expect(activeMemoryCache().get(listKey)).toBeUndefined()
    expect(activeMemoryCache().get(routeKey)).toBeUndefined()
  })

  it('上游 5xx 抛错，但缓存同样失效（不留幽灵隧道）', async () => {
    const listKey = 'probe:cloudflared:tunnels:5xx'
    activeMemoryCache().set(listKey, { items: [] }, [cloudflaredTunnelsCacheTag('tun-1')])
    const client = {
      delete: vi.fn(async (path: string) => {
        if (path.endsWith('/connections')) return {}
        throw upstreamServerError()
      }),
    }
    const service = serviceWith(client)

    await expect(service.delete('tun-1', 'tid-1')).rejects.toMatchObject({ code: 'http_error' })
    expect(activeMemoryCache().get(listKey)).toBeUndefined()
  })

  it('正常删除返回隧道 ID，且不再多删一次连接接口', async () => {
    const calls: string[] = []
    const client = {
      delete: vi.fn(async (path: string) => {
        calls.push(path)
        return { result: { id: 'tid-1' } }
      }),
    }
    const service = serviceWith(client)

    await expect(service.delete('tun-1', 'tid-1')).resolves.toEqual({ id: 'tid-1' })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.endsWith('/connections')).toBe(true)
  })
})
