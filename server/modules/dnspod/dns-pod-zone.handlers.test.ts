import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { installMemoryCache, MemoryCache } from '../../core/cache/memory-cache.js'
import { installProviderCacheState } from '../../core/cache/provider-cache.js'
import { TENCENT_PAGE_SIZE } from '../../core/providers/provider-call.js'
import { buildTestApp, cookieLineOf, makeTempDataDir } from '../../app/test-helpers.js'
import { DnsPodClient } from './dns-pod.client.js'

/**
 * 站点（/zones）路由的 handler 级回归：经真实装配的 app 打 HTTP，上游一律走 DnsPodClient.prototype.call 桩。
 * 断言面：鉴权拦截 / URL 里的 providerId 决定实际选中的服务商凭据 / refresh 透传（缓存绕过与否）/
 * 域名归一（大小写与尾点）/ 上游实参 / 成功与失败信封。
 * 前端 endpoints.zones 指向这三条路由（web/src/features/dns/api/dns-api.ts），改动必须先撞到这里。
 */

const ADMIN = { username: 'probe-admin', password: 'probe-password' }

const zonesUrl = (providerId: string) => `/api/dnspod/providers/${providerId}/zones`

type UpstreamCall = { action: string; payload: Record<string, unknown>; secretId: string }

/** 读创建客户端时选中的凭据：providerId 没被透传时这里会读到另一个服务商的密钥 */
function secretIdOf(client: DnsPodClient): string {
  return (client as unknown as { credentials: { secretId: string } }).credentials.secretId
}

/** 上游桩：先记录实参再交给 reply，reply 抛错即模拟上游失败；未登记的 action 一律抛错，绝不回落真实网络 */
function installDnsPodStub(reply: (call: UpstreamCall) => unknown): UpstreamCall[] {
  const calls: UpstreamCall[] = []
  DnsPodClient.prototype.call = async function (
    this: DnsPodClient,
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const call: UpstreamCall = { action, payload, secretId: secretIdOf(this) }
    calls.push(call)
    return reply(call) as Record<string, unknown>
  }
  return calls
}

const DOMAIN_LIST_RESPONSE = {
  DomainList: [
    {
      DomainId: 7001,
      Name: 'example.com',
      Punycode: 'example.com',
      Status: 'ENABLE',
      DnsStatus: 'DNS_NORMAL',
      Grade: 'DP_Free',
      GroupId: 2,
      RecordCount: 12,
      TTL: 600,
      Remark: 'probe zone',
      EffectiveDNS: ['ns1.dnspod.net', 'ns2.dnspod.net'],
      CreatedOn: '2024-05-06 07:08:09',
    },
  ],
  DomainCountInfo: { DomainTotal: 1 },
  RequestId: 'req-zones',
}

/** 上游域名条目经 presentZone 后的响应项：逐字段锁定，弱断言无法覆盖这条映射链 */
const PRESENTED_ZONE = {
  id: 7001,
  name: 'example.com',
  punycode: 'example.com',
  status: 'ENABLE',
  dns_status: 'DNS_NORMAL',
  grade: 'DP_Free',
  group_id: 2,
  record_count: 12,
  ttl: 600,
  remark: 'probe zone',
  effective_dns: ['ns1.dnspod.net', 'ns2.dnspod.net'],
  created_on: '2024-05-06 07:08:09',
}

let app: FastifyInstance
let sessionCookie = ''

const originalCall = DnsPodClient.prototype.call

beforeAll(async () => {
  const dataDir = await makeTempDataDir('dns-pro-dnspod-zone-')
  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify({ auth: ADMIN }, null, 2)}\n`)
  await fs.writeFile(path.join(dataDir, 'providers.json'), `${JSON.stringify({ items: [] }, null, 2)}\n`)
  app = await buildTestApp(dataDir)

  const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieLineOf(login)

  await app.ctx.workflows.providerManagement.create({
    id: 'dp-main',
    name: 'DNSPod main',
    type: 'dnspod',
    secret_id: 'secret-id-main',
    secret_key: 'secret-key-main',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'dp-alt',
    name: 'DNSPod alt',
    type: 'dnspod',
    secret_id: 'secret-id-alt',
    secret_key: 'secret-key-alt',
  })
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  // 每个用例从空缓存开始：refresh 用例靠「冷启动 -> 命中」的调用次数判定透传，不能被上个用例的条目污染
  installMemoryCache(new MemoryCache())
  installProviderCacheState()
})

afterEach(() => {
  DnsPodClient.prototype.call = originalCall
})

describe('DNSPod 站点路由：鉴权', () => {
  it('未登录的 GET/POST/DELETE 一律 401，且不触上游', async () => {
    const calls = installDnsPodStub(() => {
      throw new Error('unauthenticated request reached the DNSPod upstream')
    })

    const requests = [
      { method: 'GET' as const, url: `${zonesUrl('dp-main')}?refresh=true` },
      { method: 'POST' as const, url: zonesUrl('dp-main'), payload: { domain: 'example.com' } },
      { method: 'DELETE' as const, url: `${zonesUrl('dp-main')}/example.com` },
    ]
    for (const request of requests) {
      const response = await app.inject(request)
      expect(response.statusCode, `${request.method} ${request.url} must be rejected before the handler`).toBe(401)
      expect(response.json().code).toBe('unauthenticated')
    }
    expect(calls).toEqual([])
  })
})

describe('DNSPod 站点路由：列表', () => {
  it('列表成功：providerId 决定服务商凭据，分页实参来自共享页大小，上游域名映射为响应数据', async () => {
    const calls = installDnsPodStub(({ action }) => {
      if (action === 'DescribeDomainList') return DOMAIN_LIST_RESPONSE
      throw new Error(`unexpected DNSPod action: ${action}`)
    })

    const main = await app.inject({
      method: 'GET',
      url: `${zonesUrl('dp-main')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })
    expect(main.statusCode, main.body).toBe(200)
    const mainBody = main.json()
    expect(mainBody.code).toBe(0)
    expect(mainBody.message).toBe('success')
    expect(mainBody.data.items).toEqual([PRESENTED_ZONE])
    expect(mainBody.data.request_id).toBe('req-zones')
    expect(mainBody.data.pagination.total_count).toBe(1)

    const alt = await app.inject({
      method: 'GET',
      url: `${zonesUrl('dp-alt')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })
    expect(alt.statusCode, alt.body).toBe(200)

    expect(calls, 'providerId 未透传时会读到另一个服务商的密钥，分页实参漂移会在载荷上暴露').toEqual([
      { action: 'DescribeDomainList', payload: { Offset: 0, Limit: TENCENT_PAGE_SIZE }, secretId: 'secret-id-main' },
      { action: 'DescribeDomainList', payload: { Offset: 0, Limit: TENCENT_PAGE_SIZE }, secretId: 'secret-id-alt' },
    ])
  })

  it('refresh 透传：未声明 refresh 时命中缓存，refresh=true 时绕过缓存重新请求上游', async () => {
    const calls = installDnsPodStub(({ action }) => {
      if (action === 'DescribeDomainList') return DOMAIN_LIST_RESPONSE
      throw new Error(`unexpected DNSPod action: ${action}`)
    })

    const warm = await app.inject({ method: 'GET', url: zonesUrl('dp-main'), headers: { cookie: sessionCookie } })
    expect(warm.statusCode, warm.body).toBe(200)
    expect(calls).toHaveLength(1)

    const refreshed = await app.inject({
      method: 'GET',
      url: `${zonesUrl('dp-main')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })
    expect(refreshed.statusCode, refreshed.body).toBe(200)
    expect(calls, 'refresh=true 必须绕过缓存').toHaveLength(2)

    const cached = await app.inject({ method: 'GET', url: zonesUrl('dp-main'), headers: { cookie: sessionCookie } })
    expect(cached.statusCode, cached.body).toBe(200)
    expect(calls, 'refresh 缺省时不得重复请求上游').toHaveLength(2)
    expect(cached.json().data.items).toEqual([PRESENTED_ZONE])
  })

  it('服务商不存在：404 dnspod_provider_not_found，且不触上游', async () => {
    const calls = installDnsPodStub(() => {
      throw new Error('unknown provider request reached the DNSPod upstream')
    })

    const response = await app.inject({
      method: 'GET',
      url: `${zonesUrl('dp-missing')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe('dnspod_provider_not_found')
    expect(response.json().message).toMatch(/[\u4e00-\u9fff]/)
    expect(calls).toEqual([])
  })

  it('上游失败：非 ApiError 被包装为路由错误码 502，details 只暴露白名单字段', async () => {
    installDnsPodStub(() => {
      throw new Error('probe socket hang up')
    })

    const response = await app.inject({
      method: 'GET',
      url: `${zonesUrl('dp-main')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('dnspod_zone_list_failed')
    expect(response.json().message).toMatch(/[\u4e00-\u9fff]/)
    expect(response.json().details).toEqual({ provider_id: 'dp-main' })
  })
})

describe('DNSPod 站点路由：创建与删除', () => {
  it('创建成功 201：域名归一为 punycode 后传给上游，返回受理信息', async () => {
    const calls = installDnsPodStub(({ action }) => {
      if (action === 'CreateDomain') {
        return {
          DomainInfo: { Id: 4242, Domain: 'example.com', GradeNsList: ['ns1.dnspod.net'] },
          RequestId: 'req-create',
        }
      }
      throw new Error(`unexpected DNSPod action: ${action}`)
    })

    const response = await app.inject({
      method: 'POST',
      url: zonesUrl('dp-main'),
      headers: { cookie: sessionCookie },
      payload: { domain: 'Example.COM.' },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data).toEqual({
      id: 4242,
      name: 'example.com',
      name_servers: ['ns1.dnspod.net'],
      request_id: 'req-create',
    })
    expect(calls).toEqual([{ action: 'CreateDomain', payload: { Domain: 'example.com' }, secretId: 'secret-id-main' }])
  })

  it('创建缺 domain：400 validation_error，且不触上游', async () => {
    const calls = installDnsPodStub(() => {
      throw new Error('invalid create request reached the DNSPod upstream')
    })

    const response = await app.inject({
      method: 'POST',
      url: zonesUrl('dp-main'),
      headers: { cookie: sessionCookie },
      payload: {},
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('validation_error')
    expect(response.json().details.errors).toMatchObject({ domain: expect.any(String) })
    expect(calls).toEqual([])
  })

  it('删除成功 200：路径参数 zone 归一后传给上游', async () => {
    const calls = installDnsPodStub(({ action }) => {
      if (action === 'DeleteDomain') return { RequestId: 'req-delete' }
      throw new Error(`unexpected DNSPod action: ${action}`)
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `${zonesUrl('dp-main')}/Example.COM.`,
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ name: 'example.com', request_id: 'req-delete' })
    expect(calls).toEqual([{ action: 'DeleteDomain', payload: { Domain: 'example.com' }, secretId: 'secret-id-main' }])
  })

  it('删除上游失败：502 dnspod_zone_delete_failed', async () => {
    installDnsPodStub(() => {
      throw new Error('probe upstream rejected the delete')
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `${zonesUrl('dp-main')}/example.com`,
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('dnspod_zone_delete_failed')
    expect(response.json().details).toEqual({ provider_id: 'dp-main' })
  })
})
