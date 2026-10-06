import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMemoryCache, MemoryCache } from '../../../core/cache/memory-cache.js'
import { installProviderCacheState } from '../../../core/cache/provider-cache.js'
import { CloudflareClient } from '../cloudflare.client.js'
import { TunnelDnsService } from './tunnel-dns.service.js'
import { TunnelRouteService } from './tunnel-route.service.js'

/**
 * 迁移自 scripts/isolated-tunnel-route-probe.ts。
 *
 * 隧道路由：写回顺序（ingress → DNS）、扩展字段与 catch_all 保留、并发写入串行化、
 * CNAME 归属保护与 repair 幂等。只桩掉上游 HTTP 与 DNS 副作用，走真实
 * getConfig / writeIngress / repairRoutes 代码路径。
 */

type IngressRule = { hostname?: string; service?: string; path?: string; [key: string]: unknown }
type StubRecord = { id: string; content?: string | null }
type DnsEffects = {
  dns?: { sync?: { status?: string; message?: string }; cleanup?: { status?: string; message?: string } }
}

const dnsEffectsOf = (result: Record<string, unknown>) => (result.side_effects as DnsEffects | undefined)?.dns
const hostnameResults = (result: Record<string, unknown>) => (result.hostnames ?? []) as Array<Record<string, unknown>>

const catchAllOnly = [{ service: 'http_status:503' }]
const twoRouteConfig = (first: string, second: string, catchAll = 'http_status:404') => ({
  config: {
    ingress: [
      { hostname: first, service: 'http://a:80' },
      { hostname: second, service: 'http://b:80' },
      { service: catchAll },
    ],
  },
  version: 10,
})

function createHarness() {
  const state = {
    order: [] as string[],
    /** 首次写回后让下一次站点查询失败：验证清理失败以副作用形式返回 */
    failAfterFirstPut: false,
    /** 让下一次站点查询抛错：验证单条失败不中断其它主机名 */
    failNextZoneLookupOnce: false,
    /** 写回完成后，下一次站点查询失败（模拟「清理旧 CNAME 时查不到站点」） */
    failNextZoneLookup: false,
    /** find 返回值可切换：数组=固定结果，函数=按主机名返回（覆盖归属冲突与幂等重放） */
    findExactResult: [] as StubRecord[] | ((name: string) => StubRecord[]),
    creates: 0,
    updates: 0,
    puts: 0,
    lastPut: null as { config: { ingress: IngressRule[] } } | null,
    remoteConfig: {
      config: {
        ingress: [
          { hostname: 'old.example.com', service: 'http://origin:80', originRequest: { connectTimeout: 30 } },
          ...catchAllOnly,
        ],
      },
      version: 7,
    } as { config: { ingress: IngressRule[] }; version: number },
  }

  const zones = {
    async resolve() {
      if (state.failNextZoneLookupOnce) {
        state.failNextZoneLookupOnce = false
        throw new Error('zone lookup 502')
      }
      if (state.failNextZoneLookup) {
        state.failNextZoneLookup = false
        state.order.push('cleanup-old-dns')
        throw new Error('zone lookup 502')
      }
      return { providerId: 'cf-owner', zoneId: 'zone-1', zoneName: 'example.com' }
    },
  }

  // D3-4：隧道 DNS 改走 DnsRecordPort，桩按端口形态返回 { id, value }
  const dnsRecords = {
    async find(_providerId: string, _zone: string, probe: { name: string; type?: string }) {
      state.order.push('ensure-new-dns')
      const rows =
        typeof state.findExactResult === 'function' ? state.findExactResult(probe.name) : state.findExactResult
      return rows.map((row) => ({
        id: row.id,
        value: { type: probe.type ?? 'CNAME', name: probe.name, value: row.content ?? '' },
      }))
    },
    async create() {
      state.creates++
      return { id: `record-${state.creates}` }
    },
    async update() {
      state.updates++
      return { id: 'updated-record' }
    },
    async remove() {
      return { id: 'removed' }
    },
  }
  const dns = new TunnelDnsService(dnsRecords as never)

  // D2：隧道服务依赖 CloudflareAccess（账号 + 客户端），桩掉账号解析
  const access = {
    async forTunnel() {
      return { provider: { id: 'cf-owner' }, accountId: 'acct', client: new CloudflareClient('token') }
    },
    async linkedProviderId() {
      return 'cf-owner'
    },
  }

  vi.spyOn(CloudflareClient.prototype, 'get').mockImplementation(async (path: string) => {
    expect(path).toMatch(/\/configurations$/)
    return { success: true, result: state.remoteConfig }
  })
  vi.spyOn(CloudflareClient.prototype, 'put').mockImplementation(async (path: string, data?: unknown) => {
    expect(path).toMatch(/\/configurations$/)
    state.order.push('write-ingress')
    state.puts++
    if (state.failAfterFirstPut && state.puts === 1) state.failNextZoneLookup = true
    state.lastPut = data as { config: { ingress: IngressRule[] } }
    // 模拟上游往返延迟，暴露并发读-改-写覆盖
    await new Promise((resolve) => setTimeout(resolve, 20))
    state.remoteConfig = { config: state.lastPut.config, version: state.remoteConfig.version + 1 }
    return { success: true, result: state.remoteConfig }
  })

  const service = new TunnelRouteService(access as never, zones as never, dns)
  return { service, state }
}

beforeEach(() => {
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('隧道路由写回：顺序、字段保留与失败降级', () => {
  it('写 ingress → 同步新 CNAME → 清理旧 CNAME，扩展字段与自定义 catch_all 必须保留', async () => {
    const { service, state } = createHarness()
    state.failAfterFirstPut = true

    const result = await service.updateRoute('tunnel-owner', 'tunnel-1', 'old.example.com', '', {
      hostname: 'new.example.com',
      service: 'http://origin:80',
      path: '',
    })
    expect(state.order).toEqual(['write-ingress', 'ensure-new-dns', 'cleanup-old-dns'])
    expect(dnsEffectsOf(result)?.sync?.status).toBe('completed')
    // 清理失败不中断响应：站点查询失败以副作用形式返回
    expect(dnsEffectsOf(result)?.cleanup?.status).toBe('failed')

    // 真实写回体：扩展字段与自定义 catch_all 必须保留
    const ingress = state.lastPut?.config.ingress ?? []
    expect(ingress).toHaveLength(2)
    expect(ingress[0]?.hostname).toBe('new.example.com')
    expect(ingress[0]?.originRequest).toEqual({ connectTimeout: 30 })
    expect(ingress[1]?.service).toBe('http_status:503')
  })
})

describe('隧道路由并发：同一隧道的 Ingress 写入必须串行', () => {
  it('并发新增两条路由后都存在（不互相覆盖），catch_all 不被重置', async () => {
    const { service, state } = createHarness()
    state.remoteConfig = { config: { ingress: [...catchAllOnly] }, version: 1 }
    const putsBefore = state.puts

    await Promise.all([
      service.addRoute('tunnel-owner', 'tunnel-1', { hostname: 'a.example.com', service: 'http://a:80', path: '' }),
      service.addRoute('tunnel-owner', 'tunnel-1', { hostname: 'b.example.com', service: 'http://b:80', path: '' }),
    ])

    const hosts = (state.remoteConfig.config.ingress ?? [])
      .filter((rule) => Boolean(rule.hostname))
      .map((rule) => String(rule.hostname))
      .sort()
    expect(hosts).toEqual(['a.example.com', 'b.example.com'])
    expect(state.remoteConfig.config.ingress.at(-1)?.service).toBe('http_status:503')
    expect(state.puts - putsBefore).toBe(2)
  })
})

describe('repairRoutes：首建、幂等与归属保护', () => {
  it('首次为全部路由各建一条 CNAME，重放幂等（不重复创建、不更新）', async () => {
    const { service, state } = createHarness()
    state.remoteConfig = twoRouteConfig('repair-a.example.com', 'repair-b.example.com', 'http_status:404')

    state.findExactResult = []
    const createsBeforeRepair = state.creates
    const firstRepair = await service.repairRoutes('tunnel-owner', 'tunnel-1')
    expect(hostnameResults(firstRepair).map((item) => item.action)).toEqual(['created', 'created'])
    expect(state.creates - createsBeforeRepair).toBe(2)
    expect(dnsEffectsOf(firstRepair)?.sync?.status).toBe('completed')

    state.findExactResult = [{ id: 'record-existing', content: 'tunnel-1.cfargotunnel.com' }]
    const replay = await service.repairRoutes('tunnel-owner', 'tunnel-1')
    expect(hostnameResults(replay).map((item) => item.action)).toEqual(['unchanged', 'unchanged'])
    expect(state.creates - createsBeforeRepair).toBe(2)
    expect(state.updates).toBe(0)
    expect(dnsEffectsOf(replay)?.sync?.status).toBe('completed')
  })

  it('归属保护：同名 CNAME 指向其它目标时不覆盖、不新建，侧效应记为跳过', async () => {
    const { service, state } = createHarness()
    state.remoteConfig = twoRouteConfig('repair-a.example.com', 'repair-b.example.com', 'http_status:404')
    state.findExactResult = [{ id: 'user-record', content: 'other-tunnel.cfargotunnel.com' }]

    const createsBefore = state.creates
    const conflict = await service.repairRoutes('tunnel-owner', 'tunnel-1')
    const hostnames = hostnameResults(conflict)
    expect(hostnames.map((item) => item.action)).toEqual(['skipped', 'skipped'])
    expect(hostnames[0]?.reason).toBe('record_conflict')
    expect(String(hostnames[0]?.message)).toMatch(/other-tunnel\.cfargotunnel\.com/)
    expect(state.creates - createsBefore).toBe(0)
    expect(state.updates).toBe(0)
    expect(dnsEffectsOf(conflict)?.sync?.status).toBe('skipped')
    expect(String(dnsEffectsOf(conflict)?.sync?.message)).toMatch(/跳过 2 条/)
  })

  it('混合结果：正确记录保持不动、冲突记录跳过，汇总如实反映', async () => {
    const { service, state } = createHarness()
    state.remoteConfig = twoRouteConfig('ok.example.com', 'busy.example.com', 'http_status:404')
    // 端口层的 name 是相对主机记录（FQDN 去掉站点后缀）
    state.findExactResult = (name) =>
      name === 'ok'
        ? [{ id: 'ok-record', content: 'tunnel-1.cfargotunnel.com' }]
        : [{ id: 'busy-record', content: 'other-tunnel.cfargotunnel.com' }]

    const mixed = await service.repairRoutes('tunnel-owner', 'tunnel-1')
    expect(hostnameResults(mixed).map((item) => item.action)).toEqual(['unchanged', 'skipped'])
    expect(dnsEffectsOf(mixed)?.sync?.status).toBe('completed')
    expect(String(dnsEffectsOf(mixed)?.sync?.message)).toMatch(/跳过 1 条/)
  })

  it('单条站点解析异常只记失败，不中断其它主机名', async () => {
    const { service, state } = createHarness()
    state.remoteConfig = twoRouteConfig('ok.example.com', 'busy.example.com', 'http_status:404')
    state.findExactResult = []
    state.failNextZoneLookupOnce = true

    const degraded = await service.repairRoutes('tunnel-owner', 'tunnel-1')
    expect(hostnameResults(degraded).map((item) => item.action)).toEqual(['failed', 'created'])
    expect(hostnameResults(degraded)[0]?.error).toBe('zone lookup 502')
    expect(dnsEffectsOf(degraded)?.sync?.status).toBe('failed')
  })
})
