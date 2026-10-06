import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activeMemoryCache, installMemoryCache, MemoryCache } from '../../../core/cache/memory-cache.js'
import {
  cloudflaredTunnelConfigCacheTag,
  cloudflaredTunnelsCacheTag,
  installProviderCacheState,
} from '../../../core/cache/provider-cache.js'
import { ApiError } from '../../../core/http/api-error.js'
import { CloudflareAccess } from '../access.js'
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

/** 迁移自 scripts/isolated-saas-config-branch-probe.ts 第 3 节：令牌签发、无效响应与轮换 */
describe('token / rotateToken：令牌读取位置、形状识别与密钥轮换', () => {
  it('字符串与对象形状的令牌都必须识别，空响应按 502 拒绝', async () => {
    const results: unknown[] = ['tok-1', { token: 'tok-2' }, {}]
    const getPaths: string[] = []
    const client = {
      get: vi.fn(async (path: string) => {
        getPaths.push(path)
        return { result: results.shift() }
      }),
    }
    const service = serviceWith(client)

    await expect(service.token('tun-1', 'tid-1')).resolves.toEqual({ token: 'tok-1' })
    expect(getPaths[0]).toMatch(/\/tid-1\/token$/)
    await expect(service.token('tun-1', 'tid-1')).resolves.toEqual({ token: 'tok-2' })
    await expect(service.token('tun-1', 'tid-1')).rejects.toMatchObject({
      code: 'cloudflared_tunnel_token_invalid',
      statusCode: 502,
    })
  })

  it('轮换先写回新的 tunnel_secret 再返回新令牌，每次轮换的密钥都不同', async () => {
    const rotateSecrets: string[] = []
    const patchPaths: string[] = []
    const results: unknown[] = ['tok-rotated', 'tok-rotated-2']
    const client = {
      patch: vi.fn(async (path: string, body: unknown) => {
        patchPaths.push(path)
        rotateSecrets.push(String((body as Record<string, unknown>).tunnel_secret ?? ''))
        return { result: { id: 'tun-1' } }
      }),
      get: vi.fn(async () => ({ result: results.shift() })),
    }
    const service = serviceWith(client)

    await expect(service.rotateToken('tun-1', 'tid-1')).resolves.toEqual({ token: 'tok-rotated' })
    expect(patchPaths[0]).toMatch(/\/tid-1$/)
    expect(rotateSecrets[0]?.length).toBeGreaterThan(0)

    await expect(service.rotateToken('tun-1', 'tid-1')).resolves.toEqual({ token: 'tok-rotated-2' })
    expect(rotateSecrets[1]).not.toBe(rotateSecrets[0])
  })
})

describe('token：隧道与 Cloudflare 关联缺失的错误码', () => {
  it('未关联 Cloudflare → 422；关联的 Cloudflare 缺 account_id → 422', async () => {
    const fixtures = new Map<string, Record<string, unknown>>([
      ['cf-1', { id: 'cf-1', type: 'cloudflare', name: 'CF', api_token: 'cf-token', account_id: 'acct-1' }],
      ['cf-no-account', { id: 'cf-no-account', type: 'cloudflare', name: 'CF bare', api_token: 'cf-token-2' }],
      ['tun-1', { id: 'tun-1', type: 'cloudflared', name: 'Tunnel', cloudflare_provider: 'cf-1' }],
      ['tun-unlinked', { id: 'tun-unlinked', type: 'cloudflared', name: 'Tunnel orphan', cloudflare_provider: '' }],
      [
        'tun-no-account',
        { id: 'tun-no-account', type: 'cloudflared', name: 'Tunnel bare', cloudflare_provider: 'cf-no-account' },
      ],
    ])
    const repository = {
      requireType: async (id: string, type: string, message: string, code: string) => {
        const provider = fixtures.get(id)
        if (!provider || provider.type !== type) throw new ApiError(code, message, 404)
        return provider
      },
    }
    const service = new TunnelService(new CloudflareAccess(repository as never))

    // 错误必须来自真实 CloudflareAccess 链路，而不是桩的硬编码
    await expect(service.token('tun-unlinked', 'tid-1')).rejects.toMatchObject({
      code: 'cloudflared_cloudflare_provider_missing',
      statusCode: 422,
    })
    await expect(service.token('tun-no-account', 'tid-1')).rejects.toMatchObject({
      code: 'cloudflared_account_id_required',
      statusCode: 422,
    })
  })
})
