import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app/lifecycle.js'
import type { AppConfig } from '../../app/config.js'
import { ApiError } from '../../core/http/api-error.js'
import { CloudflareClient } from './cloudflare.client.js'

/**
 * Cloudflare 站点路由（/api/cloudflare/providers/:providerId/zones）的 handler 级契约：
 * - 列表：响应字段、分页元数据、上游 query 实参，以及 refresh=true 绕过缓存 / 缺省命中缓存；
 * - 创建：201 响应体、上游 POST 实参（name + account.id + type）、缓存失效、422/502 失败路径；
 * - 删除：站点名归一化后 idByName 解析、DELETE 路径实参、上游 id 缺失时的回退、404 失败路径。
 *
 * 上游一律走 CloudflareClient 原型桩，不发真实网络请求；装配走真实 buildApp + inject。
 */

const ADMIN = { username: 'zone-admin', password: 'zone-password' }
const SESSION_SECRET = 'zone-session-secret-that-is-longer-than-thirty-two-characters'

type StartedApp = { app: FastifyInstance; dataDir: string }

async function startApp(): Promise<StartedApp> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-cf-zone-'))
  await fs.writeFile(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ auth: { username: ADMIN.username, password: ADMIN.password } }, null, 2)
  )
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }, null, 2))
  const webDistDir = path.join(dataDir, 'webdist')
  await fs.mkdir(path.join(webDistDir, 'assets'), { recursive: true })
  await fs.writeFile(
    path.join(webDistDir, 'index.html'),
    '<!doctype html><html><body>cloudflare zone handler probe</body></html>\n'
  )

  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    webDistDir,
    sessionSecret: SESSION_SECRET,
    sessionCookieName: 'dns_pro_zone',
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    httpTimeoutMs: 1000,
  }
  const app = await buildApp(config)
  await app.ready()
  return { app, dataDir }
}

type ResponseHeaders = Record<string, string | number | string[] | undefined>

function cookieOf(response: { headers: ResponseHeaders }): string {
  const setCookies = response.headers['set-cookie']
  if (!setCookies) throw new Error('response did not set a session cookie')
  const line = Array.isArray(setCookies) ? setCookies.at(-1) : setCookies
  return String(line ?? '').split(';', 1)[0] ?? ''
}

/** 上游返回的站点原始形状（presentZone 白名单字段之外的键不会进入响应） */
function probeZone(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'zone-canonical',
    name: 'example.com',
    status: 'active',
    type: 'full',
    paused: false,
    account: { id: 'acct-zone', name: 'Zone Probe Account' },
    name_servers: ['ns1.example.com', 'ns2.example.com'],
    original_name_servers: ['ns-original.example.com'],
    created_on: '2026-01-05T00:00:00.000Z',
    modified_on: '2026-02-05T00:00:00.000Z',
    activated_on: null,
    ...overrides,
  }
}

const createdZone = {
  id: 'zone-created',
  name: 'created.example.com',
  status: 'pending',
  type: 'full',
  paused: false,
  account: { id: 'acct-zone', name: 'Zone Probe Account' },
  name_servers: [] as string[],
  original_name_servers: [] as string[],
  created_on: '2026-03-01T00:00:00.000Z',
  modified_on: null,
  activated_on: null,
}

type StubState = {
  zones: Array<Record<string, unknown>>
  getCalls: Array<{ path: string; params?: Record<string, unknown> }>
  postCalls: Array<{ path: string; body?: unknown }>
  deleteCalls: string[]
  deleteResultId: string | null
  postError: Error | null
}

const state: StubState = {
  zones: [],
  getCalls: [],
  postCalls: [],
  deleteCalls: [],
  deleteResultId: 'zone-upstream',
  postError: null,
}

const originalGet = CloudflareClient.prototype.get
const originalPost = CloudflareClient.prototype.post
const originalDelete = CloudflareClient.prototype.delete

function installStub(): void {
  CloudflareClient.prototype.get = async function (requestPath, params) {
    state.getCalls.push({ path: requestPath, params })
    if (requestPath !== 'zones') throw new Error(`Unexpected fake Cloudflare GET ${requestPath}`)
    const name = String(params?.name ?? '')
    const matched = name === '' ? state.zones : state.zones.filter((zone) => String(zone.name) === name)
    return {
      success: true,
      result: matched,
      result_info: {
        page: Number(params?.page ?? 1),
        per_page: Number(params?.per_page ?? 100),
        total_count: matched.length,
        total_pages: 1,
      },
    }
  }
  CloudflareClient.prototype.post = async function (requestPath, body) {
    state.postCalls.push({ path: requestPath, body })
    if (state.postError) throw state.postError
    return { success: true, result: createdZone }
  }
  CloudflareClient.prototype.delete = async function (requestPath) {
    state.deleteCalls.push(requestPath)
    return { success: true, result: { id: state.deleteResultId } }
  }
}

let app: FastifyInstance
let sessionCookie = ''

beforeAll(async () => {
  installStub()
  app = (await startApp()).app
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieOf(login)

  await app.ctx.workflows.providerManagement.create({
    id: 'cf-zone-a',
    name: 'Zone A',
    type: 'cloudflare',
    api_token: 'zone-token-a',
    account_id: 'acct-zone',
  })
  // account_id 缺省：POST /zones 必须在触上游前以 422 拒绝
  await app.ctx.workflows.providerManagement.create({
    id: 'cf-zone-b',
    name: 'Zone B',
    type: 'cloudflare',
    api_token: 'zone-token-b',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'cf-zone-c',
    name: 'Zone C',
    type: 'cloudflare',
    api_token: 'zone-token-c',
    account_id: 'acct-zone',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'cf-zone-empty',
    name: 'Zone Empty',
    type: 'cloudflare',
    api_token: 'zone-token-empty',
    account_id: 'acct-empty',
  })
})

afterAll(async () => {
  CloudflareClient.prototype.get = originalGet
  CloudflareClient.prototype.post = originalPost
  CloudflareClient.prototype.delete = originalDelete
  await app.close()
})

beforeEach(() => {
  state.zones = [probeZone()]
  state.getCalls = []
  state.postCalls = []
  state.deleteCalls = []
  state.deleteResultId = 'zone-upstream'
  state.postError = null
})

const zonesUrl = (providerId: string, refresh = false) =>
  `/api/cloudflare/providers/${providerId}/zones${refresh ? '?refresh=true' : ''}`

const getZones = (providerId: string, refresh = false) =>
  app.inject({ method: 'GET', url: zonesUrl(providerId, refresh), headers: { cookie: sessionCookie } })

describe('站点列表：响应字段、分页元数据与上游实参', () => {
  it('返回站点完整字段与单页分页元数据，上游 query 按全量口径传入', async () => {
    const response = await getZones('cf-zone-a', true)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.items).toEqual([
      {
        id: 'zone-canonical',
        name: 'example.com',
        status: 'active',
        type: 'full',
        paused: false,
        account: { id: 'acct-zone', name: 'Zone Probe Account' },
        name_servers: ['ns1.example.com', 'ns2.example.com'],
        original_name_servers: ['ns-original.example.com'],
        created_on: '2026-01-05T00:00:00.000Z',
        modified_on: '2026-02-05T00:00:00.000Z',
        activated_on: null,
      },
    ])
    expect(response.json().data.pagination).toEqual({
      page: 1,
      per_page: 1,
      offset: 0,
      limit: 1,
      count: 1,
      total: 1,
      total_count: 1,
      total_pages: 1,
    })
    expect(response.json().data.meta).toEqual(response.json().data.pagination)
    expect(state.getCalls).toEqual([{ path: 'zones', params: { page: 1, per_page: 100, name: undefined } }])
  })

  it('站点为空时返回空数组而不是错误', async () => {
    state.zones = []
    const response = await getZones('cf-zone-empty', true)

    expect(response.statusCode).toBe(200)
    expect(response.json().data.items).toEqual([])
    expect(response.json().data.pagination).toEqual({
      page: 1,
      per_page: 0,
      offset: 0,
      limit: 0,
      count: 0,
      total: 0,
      total_count: 0,
      total_pages: 1,
    })
  })

  it('provider 不存在时返回 404 cloudflare_provider_not_found', async () => {
    const response = await getZones('cf-zone-missing', true)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      message: 'Cloudflare 服务商不存在',
      code: 'cloudflare_provider_not_found',
      status: 404,
    })
  })
})

describe('站点列表：refresh 与缓存', () => {
  it('refresh=true 每次回源；缺省命中缓存；创建成功后缓存必须失效', async () => {
    // 强制回源建立缓存快照（1 个站点）
    const warm = await getZones('cf-zone-a', true)
    expect(warm.statusCode).toBe(200)
    const callsAfterWarm = state.getCalls.length
    expect(callsAfterWarm).toBe(1)

    // 缺省 refresh：命中缓存，不再打上游
    const cached = await getZones('cf-zone-a')
    expect(cached.statusCode).toBe(200)
    expect(state.getCalls.length).toBe(callsAfterWarm)
    expect(cached.json().data.items).toEqual(warm.json().data.items)

    // 上游新增站点：缓存未失效前不应可见
    state.zones = [probeZone(), probeZone({ id: 'zone-second', name: 'second.example.com' })]
    const stale = await getZones('cf-zone-a')
    expect(stale.json().data.items).toHaveLength(1)
    expect(state.getCalls.length).toBe(callsAfterWarm)

    // refresh=true 回源拿到新增站点
    const refreshed = await getZones('cf-zone-a', true)
    expect(refreshed.json().data.items.map((zone: { name: string }) => zone.name)).toEqual([
      'example.com',
      'second.example.com',
    ])
    expect(state.getCalls.length).toBe(callsAfterWarm + 1)
    // 回源参数按页传入，站点服务不带上游 name 过滤
    expect(state.getCalls.at(-1)?.params).toEqual({ page: 1, per_page: 100, name: undefined })
  })
})

describe('站点创建：响应、实参与失败路径', () => {
  it('201 返回创建结果，POST 实参含 name/account.id/type，且站点缓存被失效', async () => {
    // 建立「1 个站点」的缓存快照；随后桩数据变化不应立即可见
    await getZones('cf-zone-a', true)
    state.zones = [probeZone(), probeZone({ id: 'zone-second', name: 'second.example.com' })]
    const cachedBefore = await getZones('cf-zone-a')
    expect(cachedBefore.json().data.items).toHaveLength(1)

    const response = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/providers/cf-zone-a/zones',
      headers: { cookie: sessionCookie },
      payload: { name: 'created.example.com' },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data).toEqual(createdZone)
    expect(state.postCalls).toEqual([
      { path: 'zones', body: { name: 'created.example.com', account: { id: 'acct-zone' }, type: 'full' } },
    ])
    // 上游已受理 → 站点缓存必须已失效，列表立即看到新快照
    const afterCreate = await getZones('cf-zone-a')
    expect(afterCreate.json().data.items.map((zone: { name: string }) => zone.name)).toEqual([
      'example.com',
      'second.example.com',
    ])
  })

  it('provider 没有 account_id 时返回 422，且不触上游', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/providers/cf-zone-b/zones',
      headers: { cookie: sessionCookie },
      payload: { name: 'created.example.com' },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'Cloudflare 账户 ID 不能为空',
      code: 'cloudflare_account_id_required',
      status: 422,
    })
    expect(state.postCalls).toEqual([])
  })

  it('上游拒绝（Cloudflare 业务错误）时返回 502 与上游错误码', async () => {
    state.postError = new ApiError('cloudflare_request_failed', 'Cloudflare request failed: zone already exists', 502, {
      errors: [{ code: 1061, message: 'zone already exists' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/providers/cf-zone-c/zones',
      headers: { cookie: sessionCookie },
      payload: { name: 'created.example.com' },
    })

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('cloudflare_request_failed')
    expect(response.json().status).toBe(502)
    expect(response.json().details).toEqual({ errors: [{ code: 1061, message: 'zone already exists' }] })
    expect(state.postCalls).toHaveLength(1)
  })

  it('请求体缺少站点名时返回 400 validation_error，且不触上游', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/providers/cf-zone-a/zones',
      headers: { cookie: sessionCookie },
      payload: { name: '' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('validation_error')
    expect(state.postCalls).toEqual([])
  })
})

describe('站点删除：名称归一化、删除实参与失败路径', () => {
  it('按归一化站点名解析 ID 后删除该 ID，返回上游 ID', async () => {
    state.zones = [probeZone()]
    state.deleteResultId = 'zone-upstream'

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/cloudflare/providers/cf-zone-a/zones/Example.COM',
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ id: 'zone-upstream' })
    expect(state.getCalls).toEqual([{ path: 'zones', params: { page: 1, per_page: 100, name: 'example.com' } }])
    expect(state.deleteCalls).toEqual(['zones/zone-canonical'])
  })

  it('上游删除响应缺少 id 时回退为解析出的站点 ID', async () => {
    state.zones = [probeZone()]
    state.deleteResultId = null

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/cloudflare/providers/cf-zone-a/zones/example.com',
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ id: 'zone-canonical' })
    expect(state.deleteCalls).toEqual(['zones/zone-canonical'])
  })

  it('站点不存在时返回 404 cloudflare_zone_not_found，且不触上游删除', async () => {
    state.zones = []
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/cloudflare/providers/cf-zone-empty/zones/missing.example.com',
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      message: 'Cloudflare 站点不存在',
      code: 'cloudflare_zone_not_found',
      status: 404,
      details: { provider_id: 'cf-zone-empty' },
    })
    expect(state.deleteCalls).toEqual([])
  })
})
