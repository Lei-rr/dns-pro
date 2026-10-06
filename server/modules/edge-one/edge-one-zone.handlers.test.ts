import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app/lifecycle.js'
import type { AppConfig } from '../../app/config.js'
import { EdgeOneClient } from './edge-one.client.js'

/**
 * edge-one 站点路由（模块层 handler）端点级覆盖：
 * GET /api/edgeone/providers/:providerId/zones 与 GET /api/edgeone/providers/:providerId/zones/:zoneId。
 *
 * 断言口径是 handler ↔ 路由的契约，而不是服务实现细节：
 * - 路径/查询参数确实被透传：providerId 决定用哪套腾讯云凭据，zoneId 决定过滤结果，refresh 决定是否绕过缓存；
 * - 响应是 success(data) 信封（前端 unwrapList 依赖 data.items）；
 * - 失败路径的状态码与错误码：校验 400 / 服务商 404 / 未关联 DNSPod 422 / 上游 502。
 * 上游一律走 EdgeOneClient 原型桩，不发真实网络请求（与 api-records.test.ts 同方式）。
 */

const ADMIN = { username: 'probe-admin', password: 'probe-password' }
const SESSION_SECRET = 'probe-session-secret-that-is-longer-than-thirty-two-characters'

type StartedApp = { app: FastifyInstance; dataDir: string; config: AppConfig }

async function startApp(): Promise<StartedApp> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-probe-'))
  await fs.writeFile(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ auth: { username: ADMIN.username, password: ADMIN.password } }, null, 2)
  )
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }, null, 2))
  const webDistDir = path.join(dataDir, 'webdist')
  await fs.mkdir(path.join(webDistDir, 'assets'), { recursive: true })
  await fs.writeFile(
    path.join(webDistDir, 'index.html'),
    '<!doctype html><html><body>isolated api probe</body></html>\n'
  )

  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    webDistDir,
    sessionSecret: SESSION_SECRET,
    sessionCookieName: 'dns_pro_probe',
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    httpTimeoutMs: 1000,
  }
  const app = await buildApp(config)
  await app.ready()
  return { app, dataDir, config }
}

type ResponseHeaders = Record<string, string | number | string[] | undefined>

function cookieOf(response: { headers: ResponseHeaders }): string {
  const setCookies = response.headers['set-cookie']
  if (!setCookies) throw new Error('response did not set a session cookie')
  const line = Array.isArray(setCookies) ? setCookies.at(-1) : setCookies
  return String(line ?? '').split(';', 1)[0] ?? ''
}

type UpstreamCall = { action: string; payload: Record<string, unknown>; secretId: string }

/**
 * EdgeOne 上游桩：记录 Action / 载荷 / 本次调用使用的腾讯云 SecretId，返回值由 scenario 决定。
 * 记录 SecretId 是 URL 上 providerId 被真正使用的唯一可观测证据——EdgeOne 请求体里没有 ProviderId 字段，
 * 「用错凭据」只能通过密钥身份暴露（两个 EdgeOne 归属服务商分别关联不同的 DNSPod）。
 */
function stubEdgeOne(scenario: (call: UpstreamCall) => Record<string, unknown>): UpstreamCall[] {
  const calls: UpstreamCall[] = []
  EdgeOneClient.prototype.call = async function (
    this: EdgeOneClient,
    action: string,
    payload: Record<string, unknown> = {}
  ) {
    const credentials = (this as unknown as { credentials: { secretId: string } }).credentials
    const call: UpstreamCall = { action, payload, secretId: credentials.secretId }
    calls.push(call)
    return scenario(call)
  }
  return calls
}

function injectGet(url: string) {
  return app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } })
}

let app: FastifyInstance
let sessionCookie = ''

const originalEdgeOneCall = EdgeOneClient.prototype.call

afterEach(() => {
  EdgeOneClient.prototype.call = originalEdgeOneCall
})

beforeAll(async () => {
  const started = await startApp()
  app = started.app
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieOf(login)

  await app.ctx.workflows.providerManagement.create({
    id: 'edge-dns-a',
    name: 'EdgeOne linked DNSPod A',
    type: 'dnspod',
    secret_id: 'edge-secret-id-a',
    secret_key: 'edge-key-a',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'edge-dns-b',
    name: 'EdgeOne linked DNSPod B',
    type: 'dnspod',
    secret_id: 'edge-secret-id-b',
    secret_key: 'edge-key-b',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'edge-owner',
    name: 'EdgeOne owner',
    type: 'edgeone',
    dnspod_provider: 'edge-dns-a',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'edge-owner-b',
    name: 'EdgeOne owner B',
    type: 'edgeone',
    dnspod_provider: 'edge-dns-b',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'edge-owner-unlinked',
    name: 'EdgeOne owner without link',
    type: 'edgeone',
    dnspod_provider: 'edge-dns-a',
  })
})

afterAll(async () => {
  await app.close()
})

describe('EdgeOne 站点列表 GET /zones', () => {
  it('返回归一后的站点字段、隐藏类型被过滤，且用请求里 providerId 的关联凭据打上游', async () => {
    const calls = stubEdgeOne(() => ({
      Zones: [
        {
          ZoneId: 'zone-alpha',
          ZoneName: 'alpha.example.com',
          Area: 'overseas',
          Type: 'domain',
          Status: 'online',
          ActiveStatus: 'active',
          LockStatus: 'enable',
          Paused: 'true',
          CreatedOn: '2024-01-02T03:04:05Z',
          ModifiedOn: '2024-05-06T07:08:09Z',
        },
        // pages / ai 不支持加速域名管理：前端不应看到这两类站点
        { ZoneId: 'zone-pages', ZoneName: 'pages.example.com', Type: 'pages' },
        { ZoneId: 'zone-ai', ZoneName: 'ai.example.com', Type: 'AI' },
      ],
      TotalCount: 3,
      RequestId: 'req-zones-1',
    }))

    const response = await injectGet('/api/edgeone/providers/edge-owner/zones')

    expect(response.statusCode, response.body).toBe(200)
    const body = response.json()
    expect(body.code).toBe(0)
    expect(body.message).toBe('success')
    expect(body.data.request_id).toBe('req-zones-1')
    expect(body.data.items).toEqual([
      {
        id: 'zone-alpha',
        name: 'alpha.example.com',
        area: 'overseas',
        type: 'domain',
        status: 'online',
        active_status: 'active',
        lock_status: 'enable',
        paused: true,
        created_on: '2024-01-02T03:04:05Z',
        modified_on: '2024-05-06T07:08:09Z',
      },
    ])
    expect(body.data.pagination).toEqual({
      page: 1,
      per_page: 1,
      offset: 0,
      limit: 1,
      count: 1,
      total: 1,
      total_count: 1,
      total_pages: 1,
    })
    expect(calls).toEqual([
      { action: 'DescribeZones', payload: { Offset: 0, Limit: 100 }, secretId: 'edge-secret-id-a' },
    ])
  })

  it('refresh=true 每次都重新拉取；refresh=false 与缺省读取命中缓存不再打上游', async () => {
    const calls = stubEdgeOne(() => ({
      Zones: [{ ZoneId: 'zone-gamma', ZoneName: 'gamma.example.com' }],
      RequestId: 'req-gamma',
    }))
    // 独立 providerId：缓存键含 providerId，用同一个会与其它用例互相干扰
    const url = '/api/edgeone/providers/edge-owner-b/zones'

    const firstRefresh = await injectGet(`${url}?refresh=true`)
    expect(firstRefresh.statusCode, firstRefresh.body).toBe(200)
    expect(firstRefresh.json().data.request_id).toBe('req-gamma')
    const secondRefresh = await injectGet(`${url}?refresh=true`)
    expect(secondRefresh.statusCode, secondRefresh.body).toBe(200)
    // 两个 EdgeOne 服务商的链路各自独立：这里必须出现 B 的密钥
    expect(calls).toEqual([
      { action: 'DescribeZones', payload: { Offset: 0, Limit: 100 }, secretId: 'edge-secret-id-b' },
      { action: 'DescribeZones', payload: { Offset: 0, Limit: 100 }, secretId: 'edge-secret-id-b' },
    ])

    const cached = await injectGet(url)
    expect(cached.statusCode, cached.body).toBe(200)
    expect(cached.json().data.items[0].id).toBe('zone-gamma')
    const explicitlyNotRefreshed = await injectGet(`${url}?refresh=false`)
    expect(explicitlyNotRefreshed.statusCode, explicitlyNotRefreshed.body).toBe(200)
    expect(calls, 'refresh 只认字面量 true：false / 缺省都必须走缓存').toHaveLength(2)
  })

  it('查询参数非法（refresh 只接受 true/false）→ 400 validation_error，不触上游', async () => {
    const calls = stubEdgeOne(() => {
      throw new Error('invalid query must be rejected before the EdgeOne API call')
    })

    const response = await injectGet('/api/edgeone/providers/edge-owner/zones?refresh=1')

    expect(response.statusCode, response.body).toBe(400)
    const body = response.json()
    expect(body.code).toBe('validation_error')
    expect(body.status).toBe(400)
    expect(Object.keys(body.details.errors)).toContain('refresh')
    expect(calls).toHaveLength(0)
  })
})

describe('EdgeOne 站点详情 GET /zones/:zoneId', () => {
  it('按路径 zoneId 过滤列表结果，并把 refresh 判定结果一路带到上游', async () => {
    const calls = stubEdgeOne(() => ({
      Zones: [
        { ZoneId: 'zone-one', ZoneName: 'one.example.com', Status: 'online' },
        { ZoneId: 'zone-two', ZoneName: 'two.example.com', Status: 'pending' },
      ],
      RequestId: 'req-zone-show',
    }))

    const response = await injectGet('/api/edgeone/providers/edge-owner-b/zones/zone-two?refresh=true')

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ id: 'zone-two', name: 'two.example.com', status: 'pending' })
    expect(calls).toEqual([
      { action: 'DescribeZones', payload: { Offset: 0, Limit: 100 }, secretId: 'edge-secret-id-b' },
    ])
  })

  it('zoneId 不在站点列表里 → 404 edgeone_zone_not_found', async () => {
    stubEdgeOne(() => ({ Zones: [{ ZoneId: 'zone-one', ZoneName: 'one.example.com' }], RequestId: 'req-zone-miss' }))

    const response = await injectGet('/api/edgeone/providers/edge-owner-b/zones/zone-404?refresh=true')

    expect(response.statusCode, response.body).toBe(404)
    const body = response.json()
    expect(body.code).toBe('edgeone_zone_not_found')
    expect(body.status).toBe(404)
    expect(body.message).toBe('EdgeOne 站点不存在')
  })

  it('zoneId 含空白等非法字符 → 400，不触上游', async () => {
    const calls = stubEdgeOne(() => {
      throw new Error('invalid path param must be rejected before the EdgeOne API call')
    })

    const response = await injectGet('/api/edgeone/providers/edge-owner-b/zones/%20zone-one')

    expect(response.statusCode, response.body).toBe(400)
    expect(response.json().code).toBe('validation_error')
    expect(calls).toHaveLength(0)
  })
})

describe('站点路由的服务商与上游失败路径', () => {
  it('providerId 不存在或不是 edgeone → 404 edgeone_provider_not_found，且不打上游', async () => {
    const calls = stubEdgeOne(() => {
      throw new Error('provider resolution failure must not reach the EdgeOne API')
    })

    const missing = await injectGet('/api/edgeone/providers/ghost/zones')
    expect(missing.statusCode, missing.body).toBe(404)
    expect(missing.json().code).toBe('edgeone_provider_not_found')

    // 类型不符同样按「不存在」处理：拿 DNSPod 服务商当 EdgeOne 归属必须当场失败
    const wrongType = await injectGet('/api/edgeone/providers/edge-dns-a/zones')
    expect(wrongType.statusCode, wrongType.body).toBe(404)
    expect(wrongType.json().code).toBe('edgeone_provider_not_found')

    expect(calls).toHaveLength(0)
  })

  it('EdgeOne 未关联 DNSPod → 422 edgeone_dnspod_provider_missing，且不打上游', async () => {
    const calls = stubEdgeOne(() => {
      throw new Error('unlinked EdgeOne provider must not reach the EdgeOne API')
    })
    // 关联字段为空只可能来自旧数据或手工编辑（创建接口把 dnspod_provider 列为必填），
    // 因此这里绕过 ProviderService 直接改存储，构造这条运行时状态
    await app.ctx.modules.providers.repository.mutateAll((providers) =>
      providers.map((provider) =>
        provider.id === 'edge-owner-unlinked' ? { ...provider, dnspod_provider: '' } : provider
      )
    )

    const response = await injectGet('/api/edgeone/providers/edge-owner-unlinked/zones')

    expect(response.statusCode, response.body).toBe(422)
    const body = response.json()
    expect(body.code).toBe('edgeone_dnspod_provider_missing')
    expect(body.status).toBe(422)
    expect(calls).toHaveLength(0)
  })

  it('上游抛非 ApiError → 502 edgeone_zone_list_failed（错误码由站点查询登记，便于定位）', async () => {
    stubEdgeOne(() => {
      throw new Error('socket hang up')
    })

    const response = await injectGet('/api/edgeone/providers/edge-owner/zones?refresh=true')

    expect(response.statusCode, response.body).toBe(502)
    const body = response.json()
    expect(body.code).toBe('edgeone_zone_list_failed')
    expect(body.status).toBe(502)
    expect(body.details).toEqual({ provider_id: 'edge-owner' })
  })
})
