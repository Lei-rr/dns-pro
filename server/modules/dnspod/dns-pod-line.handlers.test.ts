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
 * 线路（/zones/:zone/lines）路由的 handler 级回归：经真实装配的 app 打 HTTP，上游走 DnsPodClient.prototype.call 桩。
 * 断言面：鉴权拦截 / providerId 与 zone 透传 / 套餐等级取自站点列表（DescribeDomainList）/ refresh 同时作用于
 * 线路与套餐等级两层缓存 / 空线路条目在响应前被过滤 / 成功与失败信封。
 * 前端 endpoints.lines 指向这条路由（web/src/features/dns/api/dns-api.ts），改动必须先撞到这里。
 */

const ADMIN = { username: 'probe-admin', password: 'probe-password' }

const linesUrl = (providerId: string, zone: string) => `/api/dnspod/providers/${providerId}/zones/${zone}/lines`

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

/** 套餐等级来源：线路请求必须带上这里返回的 Grade，而不是硬编码或留空 */
const DOMAIN_LIST_RESPONSE = {
  DomainList: [{ DomainId: 9001, Name: 'example.com', Punycode: 'example.com', Grade: 'DP_Free' }],
  DomainCountInfo: { DomainTotal: 1 },
  RequestId: 'req-grade',
}

const LINE_LIST_RESPONSE = {
  LineList: [
    { Name: '默认', LineId: '0' },
    // 上游偶发返回空名/空 id 的行：响应前必须被过滤，不能带进前端下拉
    { Name: '', LineId: '9' },
  ],
  LineGroupList: [{ Name: '境内', LineId: '1' }],
  RequestId: 'req-lines',
}

let app: FastifyInstance
let sessionCookie = ''

const originalCall = DnsPodClient.prototype.call

beforeAll(async () => {
  const dataDir = await makeTempDataDir('dns-pro-dnspod-line-')
  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify({ auth: ADMIN }, null, 2)}\n`)
  await fs.writeFile(path.join(dataDir, 'providers.json'), `${JSON.stringify({ items: [] }, null, 2)}\n`)
  app = await buildTestApp(dataDir)

  const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieLineOf(login)

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

describe('DNSPod 线路路由：鉴权与成功路径', () => {
  it('未登录一律 401，且不触上游', async () => {
    const calls = installDnsPodStub(() => {
      throw new Error('unauthenticated request reached the DNSPod upstream')
    })

    const response = await app.inject({ method: 'GET', url: `${linesUrl('dp-alt', 'example.com')}?refresh=true` })

    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe('unauthenticated')
    expect(calls).toEqual([])
  })

  it('线路成功：zone 归一后查询套餐等级与线路，空条目被过滤', async () => {
    const calls = installDnsPodStub(({ action }) => {
      if (action === 'DescribeDomainList') return DOMAIN_LIST_RESPONSE
      if (action === 'DescribeRecordLineList') return LINE_LIST_RESPONSE
      throw new Error(`unexpected DNSPod action: ${action}`)
    })

    const response = await app.inject({
      method: 'GET',
      url: `${linesUrl('dp-alt', 'Example.COM.')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode, response.body).toBe(200)
    const body = response.json()
    expect(body.code).toBe(0)
    expect(body.message).toBe('success')
    expect(body.data).toEqual({
      items: [{ name: '默认', line_id: '0' }],
      groups: [{ name: '境内', line_id: '1' }],
      request_id: 'req-lines',
    })

    expect(calls, 'grade 必须取自站点列表，域名必须归一为 punycode，providerId 必须选中对应密钥').toEqual([
      { action: 'DescribeDomainList', payload: { Offset: 0, Limit: TENCENT_PAGE_SIZE }, secretId: 'secret-id-alt' },
      {
        action: 'DescribeRecordLineList',
        payload: { Domain: 'example.com', DomainGrade: 'DP_Free' },
        secretId: 'secret-id-alt',
      },
    ])
  })

  it('refresh 透传：缺省命中缓存，refresh=true 同时刷新线路与套餐等级两层', async () => {
    const calls = installDnsPodStub(({ action }) => {
      if (action === 'DescribeDomainList') return DOMAIN_LIST_RESPONSE
      if (action === 'DescribeRecordLineList') return LINE_LIST_RESPONSE
      throw new Error(`unexpected DNSPod action: ${action}`)
    })
    const counts = () => [
      calls.filter((call) => call.action === 'DescribeRecordLineList').length,
      calls.filter((call) => call.action === 'DescribeDomainList').length,
    ]

    const warm = await app.inject({
      method: 'GET',
      url: linesUrl('dp-alt', 'example.com'),
      headers: { cookie: sessionCookie },
    })
    expect(warm.statusCode, warm.body).toBe(200)
    expect(counts()).toEqual([1, 1])

    const refreshed = await app.inject({
      method: 'GET',
      url: `${linesUrl('dp-alt', 'example.com')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })
    expect(refreshed.statusCode, refreshed.body).toBe(200)
    expect(counts(), 'refresh=true 必须绕过线路缓存，并把同一标志传给套餐等级来源').toEqual([2, 2])

    const cached = await app.inject({
      method: 'GET',
      url: linesUrl('dp-alt', 'example.com'),
      headers: { cookie: sessionCookie },
    })
    expect(cached.statusCode, cached.body).toBe(200)
    expect(counts(), 'refresh 缺省时不得重复请求上游').toEqual([2, 2])
  })
})

describe('DNSPod 线路路由：失败路径', () => {
  it('服务商不存在：404 dnspod_provider_not_found，且不触上游', async () => {
    const calls = installDnsPodStub(() => {
      throw new Error('unknown provider request reached the DNSPod upstream')
    })

    const response = await app.inject({
      method: 'GET',
      url: `${linesUrl('dp-missing', 'example.com')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe('dnspod_provider_not_found')
    expect(response.json().message).toMatch(/[\u4e00-\u9fff]/)
    expect(calls).toEqual([])
  })

  it('线路查询上游失败：502 dnspod_line_list_failed，details 只暴露白名单字段', async () => {
    installDnsPodStub(({ action }) => {
      if (action === 'DescribeDomainList') return DOMAIN_LIST_RESPONSE
      throw new Error('probe upstream reset the line query')
    })

    const response = await app.inject({
      method: 'GET',
      url: `${linesUrl('dp-alt', 'example.com')}?refresh=true`,
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('dnspod_line_list_failed')
    expect(response.json().message).toMatch(/[\u4e00-\u9fff]/)
    expect(response.json().details).toEqual({ provider_id: 'dp-alt' })
  })
})
