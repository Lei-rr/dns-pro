import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance, HTTPMethods } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './lifecycle.js'
import type { AppConfig } from './config.js'
import { objectSchema, paramsSchema, requestSchema, text, type RequestOf } from '../core/http/request-schema.js'

/**
 * 迁移自 scripts/isolated-api-probe.ts 的对外 HTTP 契约部分：
 * 路由清单、未认证/404/SPA 回退、登录与按来源 IP 限流、请求 schema 拒绝面、健康检查与会话注销。
 */

/** 路由清单是注册面的快照：routes.ts 漏挂/改名会在这里逐条暴露（表驱动，失败即指名路由） */
const routeManifest = JSON.parse(
  readFileSync(new URL('../../scripts/api-route-manifest.json', import.meta.url), 'utf8')
) as Array<{ method: string; path: string }>

const ADMIN = { username: 'probe-admin', password: 'probe-password' }
const SESSION_SECRET = 'probe-session-secret-that-is-longer-than-thirty-two-characters'

type StartedApp = { app: FastifyInstance; dataDir: string; config: AppConfig }

/** 独立装配：每个测试文件自己的临时 dataDir / 静态根，避免顺序耦合 */
async function startApp(): Promise<StartedApp> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-probe-'))
  await fs.writeFile(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ auth: { username: ADMIN.username, password: ADMIN.password } }, null, 2)
  )
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }, null, 2))

  // SPA 回退依赖静态根存在：指向临时目录，既不依赖 web/dist 构建产物也不污染工作区
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

let app: FastifyInstance
let cookieName = ''
let sessionCookie = ''

beforeAll(async () => {
  const started = await startApp()
  app = started.app
  cookieName = started.config.sessionCookieName
  // 会话夹具：登录走真实路由（登录本身的断言在「登录与会话」用例里独立覆盖）
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieOf(login)

  // 对账入口需要 provider 关联（SaaS 声明 DNS 目标、Tunnel/EdgeOne 挂在 Cloudflare 上）
  await app.ctx.workflows.providerManagement.create({
    id: 'cf-owner',
    name: 'CF owner',
    type: 'cloudflare',
    api_token: 'probe-token',
    account_id: 'probe-account',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'dns-target',
    name: 'DNS target',
    type: 'dnspod',
    secret_id: 'probe-secret-id',
    secret_key: 'probe-secret-key',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'saas-owner',
    name: 'SaaS owner',
    type: 'saas',
    cloudflare_provider: 'cf-owner',
    dnspod_provider: 'dns-target',
    cloudflare_dns_provider: 'cf-owner',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'tunnel-owner',
    name: 'Tunnel owner',
    type: 'cloudflared',
    cloudflare_provider: 'cf-owner',
  })
})

afterAll(async () => {
  await app.close()
})

describe('API 路由清单', () => {
  const routeCases = routeManifest.map((route) => [route.method, route.path] as const)

  it.each(routeCases)('已注册 %s %s', (method, routePath) => {
    expect(app.hasRoute({ method: method as HTTPMethods, url: routePath }), `${method} ${routePath}`).toBe(true)
  })
})

describe('未认证访问、API 404 与 SPA 回退', () => {
  it('匿名会话未登录；匿名访问业务接口返回 unauthenticated', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/session' })
    expect(anonymous.statusCode).toBe(200)
    expect(anonymous.json().data.authenticated).toBe(false)

    const anonymousProviders = await app.inject({ method: 'GET', url: '/api/providers' })
    expect(anonymousProviders.statusCode).toBe(401)
    expect(anonymousProviders.json().code).toBe('unauthenticated')
  })

  it('未知 API 路径返回 JSON 404', async () => {
    const missingApi = await app.inject({ method: 'GET', url: '/api/definitely-missing' })
    expect(missingApi.statusCode).toBe(404)
    expect(missingApi.json().code).toBe('not_found')
  })

  it('非导航请求（含 /api、/assets）不落入 SPA 回退，一律 JSON 404', async () => {
    for (const request of [
      { method: 'GET', url: '/api' },
      { method: 'GET', url: '/assets' },
      { method: 'POST', url: '/unknown' },
      { method: 'PUT', url: '/some/spa/route' },
      { method: 'GET', url: '/some/spa/route', headers: { accept: 'application/json' } },
    ] as const) {
      const response = await app.inject(request)
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(404)
      expect(String(response.headers['content-type'])).toMatch(/^application\/json/)
    }
  })

  it('浏览器导航请求回退到 index.html', async () => {
    const spa = await app.inject({ method: 'GET', url: '/some/spa/route', headers: { accept: 'text/html' } })
    expect(spa.statusCode).toBe(200)
    expect(String(spa.headers['content-type'])).toMatch(/^text\/html/)
  })
})

describe('登录与会话', () => {
  it('错误凭据返回 invalid_credentials', async () => {
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: ADMIN.username, password: 'wrong' },
    })
    expect(badLogin.statusCode).toBe(401)
    expect(badLogin.json().code).toBe('invalid_credentials')
  })

  it('同一来源连续失败触发 429 锁定，其它来源不受影响', async () => {
    // 登录路由限流：15 分钟窗口内第 6 次请求被拒；前 5 次失败只计失败次数
    // 本用例是按来源限流 + 「其它来源不受影响」的唯一覆盖（security.test.ts 的重复用例已删除，
    // 状态码之外的错误码 / retry_after 断言只有这里保留）
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { username: ADMIN.username, password: 'wrong-password' },
        remoteAddress: '192.168.1.100',
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().code).toBe('invalid_credentials')
    }
    const fifthFailed = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: ADMIN.username, password: 'wrong-password' },
      remoteAddress: '192.168.1.100',
    })
    expect(fifthFailed.statusCode).toBe(401)

    // 第 6 次：正确密码也被来源级限流拦下
    const rateLimited = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: ADMIN.username, password: ADMIN.password },
      remoteAddress: '192.168.1.100',
    })
    expect(rateLimited.statusCode).toBe(429)
    expect(rateLimited.json().code).toBe('auth_rate_limited')
    expect(String(rateLimited.json().message)).toMatch(/锁定/)
    expect(Number((rateLimited.json().details as { retry_after: number })?.retry_after) > 0).toBe(true)

    // 限流按来源 IP 计数：另一 IP 照常登录
    const otherIpLogin = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: ADMIN.username, password: ADMIN.password },
      remoteAddress: '192.168.1.200',
    })
    expect(otherIpLogin.statusCode).toBe(200)
    expect(otherIpLogin.json().data.authenticated).toBe(true)
  })

  it('登录签发会话 Cookie，重复 Cookie 头仍能解析出有效会话', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
    expect(login.statusCode).toBe(200)
    expect(login.json().data.authenticated).toBe(true)
    const setCookies = login.headers['set-cookie']
    expect(setCookies).toBeTruthy()
    const cookieLine = Array.isArray(setCookies) ? setCookies.at(-1) : setCookies
    const cookie = String(cookieLine ?? '').split(';', 1)[0] ?? ''
    expect(cookie.includes('=')).toBe(true)

    const duplicateCookie = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: `${cookieName}=stale-invalid-token; ${cookie}` },
    })
    expect(duplicateCookie.statusCode).toBe(200)
    expect(duplicateCookie.json().data.authenticated).toBe(true)
  })
})

describe('请求 schema 契约：拒绝缺字段与历史字段', () => {
  const batchBase = '/api/cloudflare/providers/missing/zones/example.com/records'
  const rejectedPayloads: Array<{ title: string; url: string; payload: Record<string, unknown> }> = [
    {
      title: 'provider 创建缺必填字段',
      url: '/api/providers',
      payload: {},
    },
    {
      title: '批量删除使用历史字段 record_ids',
      url: `${batchBase}/batch-delete`,
      payload: { record_ids: ['record-1'] },
    },
    {
      title: '批量创建使用历史字段 subdomain/record_type/content',
      url: `${batchBase}/batch-create`,
      payload: { records: [{ subdomain: 'www', record_type: 'A', content: '192.0.2.1' }] },
    },
    {
      title: 'DNSPod 站点创建使用历史字段 name',
      url: '/api/dnspod/providers/missing/zones',
      payload: { name: 'example.com' },
    },
    {
      title: 'Cloudflare 站点创建使用历史字段 domain',
      url: '/api/cloudflare/providers/missing/zones',
      payload: { domain: 'example.com' },
    },
    {
      title: 'Cloudflare 站点创建不接受 partial 类型',
      url: '/api/cloudflare/providers/missing/zones',
      payload: { name: 'example.com', type: 'partial' },
    },
    {
      title: '批量创建不接受与路径冲突的 zone_name',
      url: `${batchBase}/batch-create`,
      payload: { zone_name: 'other.example.com', records: [{ name: 'www', type: 'A', value: '192.0.2.1' }] },
    },
    {
      title: 'SaaS 批量删除使用历史载荷 items',
      url: '/api/saas/providers/missing/zones/example.com/batch/delete',
      payload: { items: ['www.example.com'] },
    },
    {
      title: 'EdgeOne 批量停用使用历史载荷 items',
      url: '/api/edgeone/providers/missing/zones/zone-1/batch/disable',
      payload: { items: ['www.example.com'] },
    },
  ]

  it.each(rejectedPayloads)('$title → 400', async ({ url, payload }) => {
    const response = await app.inject({ method: 'POST', url, headers: { cookie: sessionCookie }, payload })
    expect(response.statusCode, `${url} => ${response.statusCode}: ${response.body}`).toBe(400)
  })
})

describe('健康检查与会话注销', () => {
  it('登录后的健康检查只暴露 cache 体积键', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie: sessionCookie } })
    expect(health.statusCode).toBe(200)
    expect(Object.keys(health.json().data.cache)).toEqual(['size'])
  })

  it('注销会话返回 204', async () => {
    // 必须最后执行：注销会提升会话代次，令本文件所有已签发 Cookie 一并失效
    const login = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: ADMIN,
      remoteAddress: '192.168.9.9',
    })
    expect(login.statusCode).toBe(200)
    const logoutCookie = cookieOf(login)

    const logout = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: logoutCookie } })
    expect(logout.statusCode).toBe(204)
  })
})

/**
 * 请求 schema 的类型层契约夹具：由本测试独占持有（放在 request-schema.ts 只会是生产死导出）。
 * 断言只在类型层生效，必须在本模块有一个实例化点，tsc 的 noUnusedLocals 才不会判它未使用。
 */
type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends <Type>() => Type extends Right ? 1 : 2 ? true : false
type Expect<Value extends true> = Value
const requestSchemaTypeContractSchema = requestSchema({
  params: paramsSchema('providerId', 'zone'),
  body: objectSchema({ username: text(255), nickname: text(255) }, ['username']),
})
type ContractRequest = RequestOf<typeof requestSchemaTypeContractSchema>
type RequestSchemaTypeContract = Expect<Equal<ContractRequest['Params'], { providerId: string; zone: string }>> &
  Expect<Equal<ContractRequest['Body'], { username: string; nickname?: string }>>

describe('请求 schema 类型契约', () => {
  it('requestSchema 的 RequestOf 推导与手写预期精确一致', () => {
    // 断言在类型层：RequestOf 推导被改坏时 RequestSchemaTypeContract 不再是 true，这一行会先编译失败。
    // 夹具（Equal / Expect / requestSchemaTypeContractSchema）定义在本文件模块顶层，
    // 迁移自 isolated-api-probe.ts 的同名契约——它必须有一个模块外的实例化点，
    // 否则这一行会被 tsc 的 noUnusedLocals 当作未使用而失去意义。
    const contract: RequestSchemaTypeContract = true
    // 类型层已保证 contract 只能是 true：运行时不再断言恒真值，void 只为保留实例化点（noUnusedLocals）
    void contract
    // 运行时值只承载上面的类型推导，不需要额外断言
    expect(requestSchemaTypeContractSchema).toBeTruthy()
  })
})
