import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../../app/lifecycle.js'
import type { AppConfig } from '../../../app/config.js'
import { ApiError } from '../../../core/http/api-error.js'
import { CloudflareClient } from '../cloudflare.client.js'

/**
 * Cloudflare Tunnel 路由（/api/cloudflared/providers/:providerId/tunnels*）的 handler 级契约：
 * - 列表 / 详情 / 配置文件：响应字段、上游 query 实参、refresh=true 与缓存分支；
 * - 创建 / 删除 / 令牌读取与轮换：成功路径 + 失败与幂等分支（404、5xx、无效令牌）；
 * - ingress 路由写入：写回实参（扩展字段与自定义 catch_all 保留）、CNAME 副作用、409/422/404 失败路径；
 * - repair：逐主机名结果（created / failed / skipped）与去重、失败汇总副作用。
 *
 * 上游一律走 CloudflareClient 原型桩（含 zones / dns_records 两条 DNS 链路），不发真实网络请求。
 */

const ADMIN = { username: 'tunnel-admin', password: 'tunnel-password' }
const SESSION_SECRET = 'tunnel-session-secret-that-is-longer-than-thirty-two-characters'
const ACCOUNT = 'acct-tunnel'
const TUNNEL_PATH = `accounts/${ACCOUNT}/cfd_tunnel`
const TUNNEL_ID = 'tunnel-1'

type StartedApp = { app: FastifyInstance; dataDir: string }

async function startApp(): Promise<StartedApp> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-tunnel-'))
  await fs.writeFile(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ auth: { username: ADMIN.username, password: ADMIN.password } }, null, 2)
  )
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }, null, 2))
  const webDistDir = path.join(dataDir, 'webdist')
  await fs.mkdir(path.join(webDistDir, 'assets'), { recursive: true })
  await fs.writeFile(
    path.join(webDistDir, 'index.html'),
    '<!doctype html><html><body>cloudflared tunnel handler probe</body></html>\n'
  )

  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    webDistDir,
    sessionSecret: SESSION_SECRET,
    sessionCookieName: 'dns_pro_tunnel',
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

type IngressRule = { hostname?: string; service?: string; path?: string; [key: string]: unknown }
type StubRecord = { id: string; name: string; type: string; content: string; proxied: boolean; ttl: number }
type Call = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; arg?: unknown }

function probeTunnel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TUNNEL_ID,
    name: 'probe-tunnel',
    status: 'inactive',
    config_src: 'cloudflare',
    remote_config: true,
    connections: [
      {
        id: 'conn-1',
        client_id: 'client-1',
        client_version: '2026.1.0',
        colo_name: 'SIN',
        is_pending_reconnect: false,
        opened_at: '2026-04-01T00:00:00.000Z',
        origin_ip: '203.0.113.7',
      },
    ],
    conns_active_at: '2026-04-03T00:00:00.000Z',
    conns_inactive_at: '2026-04-02T00:00:00.000Z',
    created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 上游 ingress 配置：两条可更新路由、一条重复、一条待删、同主机名多路径，外加自定义 catch_all */
function probeConfig(): { config: { ingress: IngressRule[] }; version: number } {
  return {
    config: {
      ingress: [
        { hostname: 'old.example.com', service: 'http://origin:80', path: '', originRequest: { connectTimeout: 30 } },
        { hostname: 'same.example.com', service: 'http://same:80', path: '/x' },
        { hostname: 'dup.example.com', service: 'http://dup:80' },
        { hostname: 'old2.example.com', service: 'http://old2:80' },
        { hostname: 'multi.example.com', service: 'http://multi-a:80', path: '/a' },
        { hostname: 'multi.example.com', service: 'http://multi-b:80', path: '/b' },
        { service: 'http_status:503' },
      ],
    },
    version: 7,
  }
}

type StubState = {
  calls: Call[]
  tunnels: Array<Record<string, unknown>>
  config: { config: { ingress: IngressRule[] }; version: number }
  tokenResult: unknown
  tokenError: Error | null
  createError: Error | null
  showError: Error | null
  invalidList: boolean
  records: Record<string, StubRecord[]>
  failRecordReads: Set<string>
  connectionsDeleteError: Error | null
  tunnelDeleteError: Error | null
  lastPut: unknown
  rotateSecrets: string[]
  recordSeq: number
}

const state: StubState = {
  calls: [],
  tunnels: [],
  config: { config: { ingress: [] }, version: 0 },
  tokenResult: 'tok-1',
  tokenError: null,
  createError: null,
  showError: null,
  invalidList: false,
  records: {},
  failRecordReads: new Set(),
  connectionsDeleteError: null,
  tunnelDeleteError: null,
  lastPut: null,
  rotateSecrets: [],
  recordSeq: 0,
}

const originalGet = CloudflareClient.prototype.get
const originalPost = CloudflareClient.prototype.post
const originalPut = CloudflareClient.prototype.put
const originalPatch = CloudflareClient.prototype.patch
const originalDelete = CloudflareClient.prototype.delete

function installStub(): void {
  CloudflareClient.prototype.get = async function (requestPath, params) {
    state.calls.push({ method: 'GET', path: requestPath, arg: params })
    if (requestPath === 'zones') {
      const name = String(params?.name ?? '')
      const zones = [
        {
          id: 'zone-1',
          name: 'example.com',
          status: 'active',
          type: 'full',
          paused: false,
          account: { id: 'acct-zone' },
          name_servers: ['ns1.example.com'],
          original_name_servers: [],
          created_on: null,
          modified_on: null,
          activated_on: null,
        },
      ]
      const matched = name === '' ? zones : zones.filter((zone) => zone.name === name)
      return {
        success: true,
        result: matched,
        result_info: { page: 1, per_page: 100, total_count: matched.length, total_pages: 1 },
      }
    }
    if (requestPath === TUNNEL_PATH) {
      if (state.invalidList) return {}
      return {
        success: true,
        result: state.tunnels,
        result_info: { page: 1, per_page: 100, total_count: state.tunnels.length, total_pages: 1 },
      }
    }
    if (requestPath === `${TUNNEL_PATH}/${TUNNEL_ID}`) {
      if (state.showError) throw state.showError
      return { success: true, result: state.tunnels.find((tunnel) => tunnel.id === TUNNEL_ID) ?? {} }
    }
    if (requestPath === `${TUNNEL_PATH}/${TUNNEL_ID}/token`) {
      if (state.tokenError) throw state.tokenError
      return { success: true, result: state.tokenResult }
    }
    // 新建隧道的令牌路径带动态 id：与详情桩共用一份令牌状态
    if (new RegExp(`^${TUNNEL_PATH}/[^/]+/token$`).test(requestPath)) {
      if (state.tokenError) throw state.tokenError
      return { success: true, result: state.tokenResult }
    }
    if (requestPath === `${TUNNEL_PATH}/${TUNNEL_ID}/configurations`) {
      return { success: true, result: state.config }
    }
    if (requestPath === 'zones/zone-1/dns_records') {
      const name = String(params?.name ?? '')
      const type = String(params?.type ?? '')
      if (state.failRecordReads.has(name)) throw new Error(`probe dns_records read failure for ${name}`)
      const rows = state.records[name] ?? []
      const filtered = type === '' ? rows : rows.filter((row) => row.type === type)
      return {
        success: true,
        result: filtered,
        result_info: { page: 1, per_page: 100, total_count: filtered.length, total_pages: 1 },
      }
    }
    throw new Error(`Unexpected fake Cloudflare GET ${requestPath}`)
  }

  CloudflareClient.prototype.post = async function (requestPath, body) {
    state.calls.push({ method: 'POST', path: requestPath, arg: body })
    if (requestPath === TUNNEL_PATH) {
      if (state.createError) throw state.createError
      const payload = body as Record<string, unknown>
      return {
        success: true,
        result: {
          id: 'tunnel-created',
          name: String(payload.name ?? ''),
          status: 'inactive',
          config_src: 'cloudflare',
          connections: [],
        },
      }
    }
    if (requestPath === 'zones/zone-1/dns_records') {
      const payload = body as Record<string, unknown>
      state.recordSeq += 1
      const record: StubRecord = {
        id: `record-${state.recordSeq}`,
        name: String(payload.name ?? ''),
        type: String(payload.type ?? ''),
        content: String(payload.content ?? ''),
        proxied: Boolean(payload.proxied),
        ttl: Number(payload.ttl ?? 1),
      }
      state.records[record.name] = [...(state.records[record.name] ?? []), record]
      return { success: true, result: { ...record, zone_id: 'zone-1', zone_name: 'example.com' } }
    }
    throw new Error(`Unexpected fake Cloudflare POST ${requestPath}`)
  }

  CloudflareClient.prototype.put = async function (requestPath, body) {
    state.calls.push({ method: 'PUT', path: requestPath, arg: body })
    if (requestPath === `${TUNNEL_PATH}/${TUNNEL_ID}/configurations`) {
      state.lastPut = body
      state.config = {
        config: (body as { config: { ingress: IngressRule[] } }).config,
        version: state.config.version + 1,
      }
      return { success: true, result: state.config }
    }
    throw new Error(`Unexpected fake Cloudflare PUT ${requestPath}`)
  }

  CloudflareClient.prototype.patch = async function (requestPath, body) {
    state.calls.push({ method: 'PATCH', path: requestPath, arg: body })
    if (requestPath === `${TUNNEL_PATH}/${TUNNEL_ID}`) {
      state.rotateSecrets.push(String((body as Record<string, unknown>).tunnel_secret ?? ''))
      return { success: true, result: { id: TUNNEL_ID } }
    }
    throw new Error(`Unexpected fake Cloudflare PATCH ${requestPath}`)
  }

  CloudflareClient.prototype.delete = async function (requestPath) {
    state.calls.push({ method: 'DELETE', path: requestPath })
    if (requestPath === `${TUNNEL_PATH}/${TUNNEL_ID}/connections`) {
      if (state.connectionsDeleteError) throw state.connectionsDeleteError
      return { success: true, result: { id: TUNNEL_ID } }
    }
    if (requestPath === `${TUNNEL_PATH}/${TUNNEL_ID}`) {
      if (state.tunnelDeleteError) throw state.tunnelDeleteError
      return { success: true, result: { id: TUNNEL_ID } }
    }
    const recordMatch = /^zones\/zone-1\/dns_records\/(.+)$/.exec(requestPath)
    if (recordMatch) {
      const recordId = decodeURIComponent(recordMatch[1] ?? '')
      for (const rows of Object.values(state.records)) {
        const index = rows.findIndex((row) => row.id === recordId)
        if (index !== -1) rows.splice(index, 1)
      }
      return { success: true, result: { id: recordId } }
    }
    throw new Error(`Unexpected fake Cloudflare DELETE ${requestPath}`)
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
    id: 'cf-tunnel-link',
    name: 'Tunnel Cloudflare',
    type: 'cloudflare',
    api_token: 'tunnel-token',
    account_id: ACCOUNT,
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'tun-main',
    name: 'Main tunnel',
    type: 'cloudflared',
    cloudflare_provider: 'cf-tunnel-link',
  })
})

afterAll(async () => {
  CloudflareClient.prototype.get = originalGet
  CloudflareClient.prototype.post = originalPost
  CloudflareClient.prototype.put = originalPut
  CloudflareClient.prototype.patch = originalPatch
  CloudflareClient.prototype.delete = originalDelete
  await app.close()
})

beforeEach(() => {
  state.calls = []
  state.tunnels = [probeTunnel()]
  state.config = probeConfig()
  state.tokenResult = 'tok-1'
  state.tokenError = null
  state.createError = null
  state.showError = null
  state.invalidList = false
  state.records = {}
  state.failRecordReads = new Set()
  state.connectionsDeleteError = null
  state.tunnelDeleteError = null
  state.lastPut = null
  state.rotateSecrets = []
  state.recordSeq = 0
})

const api = (suffix: string) => `/api/cloudflared/providers/tun-main/tunnels${suffix}`

const injectGet = (suffix: string) =>
  app.inject({ method: 'GET', url: api(suffix), headers: { cookie: sessionCookie } })

const injectJson = (method: 'POST' | 'PUT' | 'DELETE', suffix: string, payload?: Record<string, unknown>) =>
  app.inject({
    method,
    url: api(suffix),
    headers: { cookie: sessionCookie },
    ...(payload === undefined ? {} : { payload }),
  })

const callsOf = (method: Call['method']) => state.calls.filter((call) => call.method === method)

/** base-http.client 折叠后的上游 404：状态码 400 + details.upstream_status=404 */
const upstreamNotFound = () =>
  new ApiError('http_error', 'Provider API error: 404 Not Found', 400, { upstream_status: 404 })
const upstreamServerError = () =>
  new ApiError('http_error', 'Provider API error: 500 Internal Server Error', 502, { upstream_status: 500 })

describe('隧道列表：字段、上游实参与 refresh 分支', () => {
  it('返回隧道完整字段，上游 query 按未删除全量口径传入', async () => {
    const response = await injectGet('?refresh=true')

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.items).toEqual([
      {
        id: TUNNEL_ID,
        name: 'probe-tunnel',
        status: 'inactive',
        config_src: 'cloudflare',
        remote_config: true,
        connections: [
          {
            id: 'conn-1',
            client_id: 'client-1',
            client_version: '2026.1.0',
            colo_name: 'SIN',
            is_pending_reconnect: false,
            opened_at: '2026-04-01T00:00:00.000Z',
            origin_ip: '203.0.113.7',
          },
        ],
        conns_active_at: '2026-04-03T00:00:00.000Z',
        conns_inactive_at: '2026-04-02T00:00:00.000Z',
        created_at: '2026-03-01T00:00:00.000Z',
      },
    ])
    expect(callsOf('GET').map((call) => ({ path: call.path, arg: call.arg }))).toEqual([
      { path: TUNNEL_PATH, arg: { is_deleted: 'false', page: 1, per_page: 100 } },
    ])
  })

  it('refresh=true 回源、缺省命中缓存', async () => {
    const warm = await injectGet('?refresh=true')
    expect(warm.statusCode).toBe(200)
    expect(callsOf('GET')).toHaveLength(1)

    state.tunnels = [probeTunnel({ status: 'healthy' })]
    const cached = await injectGet('')
    expect(cached.statusCode).toBe(200)
    expect(callsOf('GET')).toHaveLength(1)
    expect(cached.json().data.items[0].status).toBe('inactive')

    const refreshed = await injectGet('?refresh=true')
    expect(callsOf('GET')).toHaveLength(2)
    expect(refreshed.json().data.items[0].status).toBe('healthy')
  })

  it('上游返回非法列表响应时 502 cloudflare_invalid_response', async () => {
    state.invalidList = true
    const response = await injectGet('?refresh=true')

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('cloudflare_invalid_response')
    expect(response.json().status).toBe(502)
  })
})

describe('隧道创建：响应、副作用与失败路径', () => {
  it('201 返回隧道与令牌，POST 实参含 trim 后的名称/cloudflare 配置源/随机密钥', async () => {
    const response = await injectJson('POST', '', { name: '  probe tunnel  ' })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.tunnel).toEqual({
      id: 'tunnel-created',
      name: 'probe tunnel',
      status: 'inactive',
      config_src: 'cloudflare',
      remote_config: false,
      connections: [],
    })
    expect(response.json().data.token).toBe('tok-1')
    expect(response.json().data.side_effects).toBeUndefined()

    const postCall = callsOf('POST')[0]
    expect(postCall?.path).toBe(TUNNEL_PATH)
    const payload = postCall?.arg as Record<string, unknown>
    expect(payload.name).toBe('probe tunnel')
    expect(payload.config_src).toBe('cloudflare')
    expect(String(payload.tunnel_secret)).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(callsOf('GET').map((call) => call.path)).toEqual([`${TUNNEL_PATH}/tunnel-created/token`])
  })

  it('令牌取回失败不回滚隧道：201 + token=null + 失败副作用', async () => {
    state.tokenError = new ApiError('cloudflare_connection_failed', 'Cloudflare connection failed', 502)

    const response = await injectJson('POST', '', { name: 'probe tunnel' })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.token).toBeNull()
    expect(response.json().data.tunnel.id).toBe('tunnel-created')
    expect(response.json().data.side_effects.tunnel.token).toEqual({
      status: 'failed',
      message: 'Cloudflare connection failed',
      details: [{ tunnel_id: 'tunnel-created' }],
    })
  })

  it('上游创建失败（网络层）时 502 cloudflared_tunnel_create_failed', async () => {
    state.createError = new Error('socket hang up')

    const response = await injectJson('POST', '', { name: 'probe tunnel' })

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('cloudflared_tunnel_create_failed')
    expect(response.json().status).toBe(502)
    expect(callsOf('GET')).toHaveLength(0)
  })
})

describe('隧道详情与删除', () => {
  it('详情返回单隧道字段，且 refresh=true 回源', async () => {
    const warm = await injectGet(`/${TUNNEL_ID}?refresh=true`)
    expect(warm.statusCode, warm.body).toBe(200)
    expect(warm.json().data.name).toBe('probe-tunnel')
    expect(warm.json().data.connections[0].id).toBe('conn-1')
    expect(callsOf('GET').map((call) => call.path)).toEqual([`${TUNNEL_PATH}/${TUNNEL_ID}`])

    state.tunnels = [probeTunnel({ name: 'renamed-tunnel' })]
    const cached = await injectGet(`/${TUNNEL_ID}`)
    expect(cached.json().data.name).toBe('probe-tunnel')
    const refreshed = await injectGet(`/${TUNNEL_ID}?refresh=true`)
    expect(refreshed.json().data.name).toBe('renamed-tunnel')
    expect(callsOf('GET')).toHaveLength(2)
  })

  it('详情上游连接失败时按原错误码 502 透传', async () => {
    state.showError = new ApiError('cloudflare_connection_failed', 'Cloudflare connection failed', 502, {
      original_error: 'ECONNRESET',
    })

    const response = await injectGet(`/${TUNNEL_ID}?refresh=true`)

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('cloudflare_connection_failed')
  })

  it('删除先断连接再删隧道本体', async () => {
    const response = await injectJson('DELETE', `/${TUNNEL_ID}`)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ id: TUNNEL_ID })
    expect(callsOf('DELETE').map((call) => call.path)).toEqual([
      `${TUNNEL_PATH}/${TUNNEL_ID}/connections`,
      `${TUNNEL_PATH}/${TUNNEL_ID}`,
    ])
  })

  it('连接与隧道本体在上游都已不存在时按已删除处理（幂等 200）', async () => {
    state.connectionsDeleteError = upstreamNotFound()
    state.tunnelDeleteError = upstreamNotFound()

    const response = await injectJson('DELETE', `/${TUNNEL_ID}`)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ id: TUNNEL_ID })
    expect(callsOf('DELETE')).toHaveLength(2)
  })

  it('断开连接失败（上游 5xx）时 502，且不再删除隧道本体', async () => {
    state.connectionsDeleteError = upstreamServerError()

    const response = await injectJson('DELETE', `/${TUNNEL_ID}`)

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('http_error')
    expect(response.json().details).toEqual({ upstream_status: 500 })
    expect(callsOf('DELETE')).toHaveLength(1)
  })

  it('隧道本体删除失败（上游 5xx）时 502 透传', async () => {
    state.tunnelDeleteError = upstreamServerError()

    const response = await injectJson('DELETE', `/${TUNNEL_ID}`)

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('http_error')
    expect(response.json().details).toEqual({ upstream_status: 500 })
    expect(callsOf('DELETE')).toHaveLength(2)
  })
})

describe('隧道令牌：读取、形状与轮换', () => {
  it('字符串与对象形状的令牌都按原值返回', async () => {
    const first = await injectGet(`/${TUNNEL_ID}/token`)
    expect(first.statusCode).toBe(200)
    expect(first.json().data).toEqual({ token: 'tok-1' })

    state.tokenResult = { token: 'tok-object' }
    const second = await injectGet(`/${TUNNEL_ID}/token`)
    expect(second.json().data).toEqual({ token: 'tok-object' })
    expect(callsOf('GET').map((call) => call.path)).toEqual([
      `${TUNNEL_PATH}/${TUNNEL_ID}/token`,
      `${TUNNEL_PATH}/${TUNNEL_ID}/token`,
    ])
  })

  it('上游返回空令牌时 502 cloudflared_tunnel_token_invalid', async () => {
    state.tokenResult = ''

    const response = await injectGet(`/${TUNNEL_ID}/token`)

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('cloudflared_tunnel_token_invalid')
  })

  it('轮换先写回新密钥再返回新令牌，每次密钥不同', async () => {
    const rotate = await injectJson('POST', `/${TUNNEL_ID}/token/rotate`)
    expect(rotate.statusCode, rotate.body).toBe(200)
    expect(rotate.json().data).toEqual({ token: 'tok-1' })

    const patchCall = callsOf('PATCH')[0]
    expect(patchCall?.path).toBe(`${TUNNEL_PATH}/${TUNNEL_ID}`)
    const firstSecret = String((patchCall?.arg as Record<string, unknown>).tunnel_secret)
    expect(firstSecret).toMatch(/^[A-Za-z0-9+/]{43}=$/)

    state.tokenResult = 'tok-2'
    await injectJson('POST', `/${TUNNEL_ID}/token/rotate`)
    expect(state.rotateSecrets).toHaveLength(2)
    expect(state.rotateSecrets[1]).not.toBe(state.rotateSecrets[0])
  })

  it('密钥已换但令牌取回失败时按部分成功返回（token=null + 副作用）', async () => {
    state.tokenError = new ApiError('cloudflare_connection_failed', 'Cloudflare connection failed', 502)

    const response = await injectJson('POST', `/${TUNNEL_ID}/token/rotate`)

    expect(response.statusCode, response.body).toBe(200)
    // 副作用随业务字段一起在 data 下（与全仓其它 handler 一致，前端 readSideEffect 按此读取）
    expect(response.json().data.token).toBeNull()
    expect(response.json().data.side_effects.tunnel.token.status).toBe('failed')
    expect(callsOf('PATCH')).toHaveLength(1)
  })
})

describe('隧道路由配置读取', () => {
  it('解析 ingress：路由字段归一化、扩展字段保留、自定义 catch_all 与 version 原样返回', async () => {
    const response = await injectGet(`/${TUNNEL_ID}/routes?refresh=true`)

    expect(response.statusCode, response.body).toBe(200)
    const data = response.json().data
    expect(data.version).toBe(7)
    expect(data.catch_all).toBe('http_status:503')
    expect(data.routes).toEqual([
      {
        hostname: 'old.example.com',
        service: 'http://origin:80',
        path: '',
        originRequest: { connectTimeout: 30 },
      },
      { hostname: 'same.example.com', service: 'http://same:80', path: '/x' },
      { hostname: 'dup.example.com', service: 'http://dup:80', path: '' },
      { hostname: 'old2.example.com', service: 'http://old2:80', path: '' },
      { hostname: 'multi.example.com', service: 'http://multi-a:80', path: '/a' },
      { hostname: 'multi.example.com', service: 'http://multi-b:80', path: '/b' },
    ])
    expect(Object.keys(data)).toEqual(['routes', 'catch_all', 'version'])
    expect(callsOf('GET').map((call) => call.path)).toEqual([`${TUNNEL_PATH}/${TUNNEL_ID}/configurations`])
  })

  it('缺省 refresh 时命中配置缓存，不再回源', async () => {
    const warm = await injectGet(`/${TUNNEL_ID}/routes?refresh=true`)
    expect(warm.statusCode).toBe(200)
    const configCalls = () => callsOf('GET').filter((call) => call.path.endsWith('/configurations')).length
    expect(configCalls()).toBe(1)

    state.config = { config: { ingress: [{ service: 'http_status:503' }] }, version: 99 }
    const cached = await injectGet(`/${TUNNEL_ID}/routes`)

    expect(cached.statusCode).toBe(200)
    expect(cached.json().data.version).toBe(7)
    expect(configCalls()).toBe(1)
  })

  it('配置响应非法时 502 cloudflare_invalid_response', async () => {
    // 用空对象模拟无法解析的上游响应（beforeEach 会在下一个用例前恢复）
    state.config = {} as unknown as StubState['config']

    const response = await injectGet(`/${TUNNEL_ID}/routes?refresh=true`)

    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('cloudflare_invalid_response')
  })
})

describe('隧道路由写入：新增', () => {
  it('写回 ingress 时保留扩展字段与自定义 catch_all，并创建指向隧道的 CNAME', async () => {
    const response = await injectJson('POST', `/${TUNNEL_ID}/routes`, {
      hostname: 'new.example.com',
      service: '  http://localhost:8080  ',
      path: '  /api  ',
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data).toEqual({
      hostname: 'new.example.com',
      service: 'http://localhost:8080',
      path: '/api',
      side_effects: {
        dns: {
          sync: {
            status: 'completed',
            message: '已执行 Cloudflare DNS 同步',
            details: [{ action: 'created', record_id: 'record-1' }],
          },
        },
      },
    })

    const ingress = (state.lastPut as { config: { ingress: IngressRule[] } }).config.ingress
    expect(ingress.map((rule) => rule.hostname ?? '(catch_all)')).toEqual([
      'old.example.com',
      'same.example.com',
      'dup.example.com',
      'old2.example.com',
      'multi.example.com',
      'multi.example.com',
      'new.example.com',
      '(catch_all)',
    ])
    expect(ingress[0]?.originRequest).toEqual({ connectTimeout: 30 })
    expect(ingress.at(-1)).toEqual({ service: 'http_status:503' })

    const recordsRead = callsOf('GET').find((call) => call.path === 'zones/zone-1/dns_records')
    expect(recordsRead?.arg).toEqual({ page: 1, per_page: 100, type: 'CNAME', name: 'new.example.com' })
    const recordWrite = callsOf('POST').find((call) => call.path === 'zones/zone-1/dns_records')
    expect(recordWrite?.arg).toEqual({
      type: 'CNAME',
      name: 'new.example.com',
      content: 'tunnel-1.cfargotunnel.com',
      proxied: true,
      ttl: 1,
    })
    expect(state.records['new.example.com']).toHaveLength(1)
  })

  it('请求体不带 path 时按空前缀写回，ingress 中不含 path 键', async () => {
    const response = await injectJson('POST', `/${TUNNEL_ID}/routes`, {
      hostname: 'plain.example.com',
      service: 'http://plain:80',
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data).toEqual({
      hostname: 'plain.example.com',
      service: 'http://plain:80',
      path: '',
      side_effects: {
        dns: {
          sync: {
            status: 'completed',
            message: '已执行 Cloudflare DNS 同步',
            details: [{ action: 'created', record_id: 'record-1' }],
          },
        },
      },
    })
    const ingress = (state.lastPut as { config: { ingress: IngressRule[] } }).config.ingress
    expect(ingress.at(-2)).toEqual({ hostname: 'plain.example.com', service: 'http://plain:80' })
  })

  it('路由已存在时 409 cloudflared_route_exists，且不写回上游', async () => {
    const response = await injectJson('POST', `/${TUNNEL_ID}/routes`, {
      hostname: 'dup.example.com',
      service: 'http://other:80',
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('cloudflared_route_exists')
    expect(callsOf('PUT')).toHaveLength(0)
    expect(callsOf('POST')).toHaveLength(0)
  })

  it('主机名不属于任何站点时 422 cloudflared_zone_not_found', async () => {
    const response = await injectJson('POST', `/${TUNNEL_ID}/routes`, {
      hostname: 'ghost.other',
      service: 'http://ghost:80',
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().code).toBe('cloudflared_zone_not_found')
    expect(callsOf('PUT')).toHaveLength(0)
  })
})

describe('隧道路由写入：更新', () => {
  it('按 original_hostname/original_path 定位原路由，保留扩展字段并清理旧 CNAME', async () => {
    state.records['old.example.com'] = [
      {
        id: 'record-old',
        name: 'old.example.com',
        type: 'CNAME',
        content: 'tunnel-1.cfargotunnel.com',
        proxied: true,
        ttl: 1,
      },
    ]

    const response = await injectJson('PUT', `/${TUNNEL_ID}/routes?original_hostname=old.example.com&original_path=`, {
      hostname: 'new.example.com',
      service: 'http://renamed:80',
      path: '',
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      hostname: 'new.example.com',
      service: 'http://renamed:80',
      path: '',
      side_effects: {
        dns: {
          sync: {
            status: 'completed',
            message: '已执行 Cloudflare DNS 同步',
            details: [{ action: 'created', record_id: 'record-1' }],
          },
          cleanup: {
            status: 'completed',
            message: '已执行旧 Cloudflare DNS 清理',
            details: [{ action: 'deleted', record_id: 'record-old' }],
          },
        },
      },
    })

    const ingress = (state.lastPut as { config: { ingress: IngressRule[] } }).config.ingress
    expect(ingress.map((rule) => rule.hostname ?? '(catch_all)')).toEqual([
      'new.example.com',
      'same.example.com',
      'dup.example.com',
      'old2.example.com',
      'multi.example.com',
      'multi.example.com',
      '(catch_all)',
    ])
    // 原规则里的 originRequest 必须跟着新主机名保留下来
    expect(ingress[0]?.originRequest).toEqual({ connectTimeout: 30 })
    expect(callsOf('DELETE').map((call) => call.path)).toEqual(['zones/zone-1/dns_records/record-old'])
  })

  it('缺省 original_hostname 时以请求体自身的 hostname/path 定位，主机名未变则无清理副作用', async () => {
    const response = await injectJson('PUT', `/${TUNNEL_ID}/routes`, {
      hostname: 'same.example.com',
      service: 'http://same-updated:80',
      path: '/x',
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.hostname).toBe('same.example.com')
    expect(response.json().data.service).toBe('http://same-updated:80')
    expect(response.json().data.side_effects.dns.sync.status).toBe('completed')
    expect('cleanup' in response.json().data.side_effects.dns).toBe(false)

    const ingress = (state.lastPut as { config: { ingress: IngressRule[] } }).config.ingress
    expect(ingress[1]).toEqual({ hostname: 'same.example.com', service: 'http://same-updated:80', path: '/x' })
  })

  it('缺省 original_hostname 且请求体不带 path 时按空前缀定位原路由', async () => {
    const response = await injectJson('PUT', `/${TUNNEL_ID}/routes`, {
      hostname: 'dup.example.com',
      service: 'http://dup-updated:80',
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.service).toBe('http://dup-updated:80')
    expect(response.json().data.path).toBe('')
    expect('cleanup' in response.json().data.side_effects.dns).toBe(false)

    const ingress = (state.lastPut as { config: { ingress: IngressRule[] } }).config.ingress
    // 空前缀写回时不带 path 键，其余规则位置不变
    expect(ingress[2]).toEqual({ hostname: 'dup.example.com', service: 'http://dup-updated:80' })
    expect(ingress[3]).toEqual({ hostname: 'old2.example.com', service: 'http://old2:80' })
  })

  it('original_path 非空时以「主机名 + 路径」精确命中同主机名的某一条路由', async () => {
    const response = await injectJson(
      'PUT',
      `/${TUNNEL_ID}/routes?original_hostname=multi.example.com&original_path=/a`,
      { hostname: 'multi.example.com', service: 'http://multi-a-updated:80', path: '/a' }
    )

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.service).toBe('http://multi-a-updated:80')
    expect(response.json().data.path).toBe('/a')
    expect('cleanup' in response.json().data.side_effects.dns).toBe(false)

    const ingress = (state.lastPut as { config: { ingress: IngressRule[] } }).config.ingress
    // 只改 /a 那条，/b 那条必须原样保留
    expect(ingress[4]).toEqual({ hostname: 'multi.example.com', service: 'http://multi-a-updated:80', path: '/a' })
    expect(ingress[5]).toEqual({ hostname: 'multi.example.com', service: 'http://multi-b:80', path: '/b' })
  })

  it('原路由不存在时 404 cloudflared_route_not_found', async () => {
    const response = await injectJson('PUT', `/${TUNNEL_ID}/routes?original_hostname=nope.example.com`, {
      hostname: 'new.example.com',
      service: 'http://renamed:80',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe('cloudflared_route_not_found')
    expect(callsOf('PUT')).toHaveLength(0)
  })
})

describe('隧道路由写入：删除与修复', () => {
  it('删除单条路由并清理其 CNAME（缺省 path 视为空路径）', async () => {
    state.records['old2.example.com'] = [
      {
        id: 'record-old2',
        name: 'old2.example.com',
        type: 'CNAME',
        content: 'tunnel-1.cfargotunnel.com',
        proxied: true,
        ttl: 1,
      },
    ]

    const response = await injectJson('DELETE', `/${TUNNEL_ID}/routes?hostname=old2.example.com`)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      hostname: 'old2.example.com',
      path: '',
      side_effects: {
        dns: {
          cleanup: {
            status: 'completed',
            message: '已执行 Cloudflare DNS 清理',
            details: [{ action: 'deleted', record_id: 'record-old2' }],
          },
        },
      },
    })
    const ingress = (state.lastPut as { config: { ingress: IngressRule[] } }).config.ingress
    expect(ingress.some((rule) => rule.hostname === 'old2.example.com')).toBe(false)
  })

  it('同主机名仍有其它路径路由时保留 CNAME（cleanup=kept/skipped）', async () => {
    const response = await injectJson('DELETE', `/${TUNNEL_ID}/routes?hostname=multi.example.com&path=/a`)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      hostname: 'multi.example.com',
      path: '/a',
      side_effects: {
        dns: {
          cleanup: {
            status: 'skipped',
            message: '已执行 Cloudflare DNS 清理',
            details: [{ action: 'kept', reason: 'hostname_still_used' }],
          },
        },
      },
    })
    expect(callsOf('DELETE')).toHaveLength(0)
  })

  it('待删路由不存在时 404 cloudflared_route_not_found', async () => {
    const response = await injectJson('DELETE', `/${TUNNEL_ID}/routes?hostname=nope.example.com`)

    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe('cloudflared_route_not_found')
    expect(callsOf('PUT')).toHaveLength(0)
  })

  it('修复按主机名去重逐条执行：created / failed / skipped 如实返回', async () => {
    state.config = {
      config: {
        ingress: [
          { hostname: 'repair-a.example.com', service: 'http://a:80' },
          { hostname: 'repair-b.example.com', service: 'http://b:80' },
          { hostname: 'ghost.other', service: 'http://ghost:80' },
          { hostname: 'repair-a.example.com', service: 'http://a-dup:80' },
          { service: 'http_status:404' },
        ],
      },
      version: 3,
    }
    state.failRecordReads.add('repair-b.example.com')

    const response = await injectJson('POST', `/${TUNNEL_ID}/routes/repair`)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.tunnel_id).toBe(TUNNEL_ID)
    expect(response.json().data.hostnames).toEqual([
      { hostname: 'repair-a.example.com', zone_id: 'zone-1', action: 'created', record_id: 'record-1' },
      {
        hostname: 'repair-b.example.com',
        zone_id: 'zone-1',
        action: 'failed',
        error: 'Cloudflare record list failed',
      },
      { hostname: 'ghost.other', zone_id: '', action: 'skipped', reason: 'zone_not_found' },
    ])
    expect(response.json().data.side_effects.dns.sync.status).toBe('failed')
    expect(response.json().data.side_effects.dns.sync.message).toBe('已同步 1 条、跳过 1 条、失败 1 条')
    expect(state.records['repair-a.example.com']).toHaveLength(1)
    // repair 不改 ingress
    expect(callsOf('PUT')).toHaveLength(0)
  })
})
