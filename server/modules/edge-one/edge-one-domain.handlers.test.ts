import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app/lifecycle.js'
import type { AppConfig } from '../../app/config.js'
import { ApiError } from '../../core/http/api-error.js'
import { EdgeOneClient } from './edge-one.client.js'

/**
 * edge-one 加速域名路由（模块层 handler）端点级覆盖：
 * - GET  /api/edgeone/providers/:providerId/zones/:zoneId/records（列表）；
 * - PUT  /api/edgeone/providers/:providerId/zones/:zoneId/records/:domainName（更新配置）；
 * - PUT  .../status（启停）、PUT .../certificate（证书）。
 *
 * 断言口径是 handler ↔ 路由的契约：
 * - 路径参数与请求体确实按请求透传到上游（ZoneId / DomainName / DomainNames / Hosts / 各字段）；
 * - 部分更新只下发显式提供的字段（ModifyAccelerationDomain 对缺省字段的语义是保持原配置，
 *   回填默认值等于静默重置用户的回源协议与端口）；
 * - 失败路径的状态码与错误码：校验 400 / 服务商 404 / 证书缺 CertId 422 / 上游 502 / 上游响应不合法 502。
 * 上游一律走 EdgeOneClient 原型桩，不发真实网络请求（与 cloudflare-zone.handlers.test.ts 同方式）。
 */

const ADMIN = { username: 'domain-admin', password: 'domain-password' }
const SESSION_SECRET = 'domain-session-secret-that-is-longer-than-thirty-two-characters'

type StartedApp = { app: FastifyInstance; dataDir: string }

async function startApp(): Promise<StartedApp> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-eo-domain-'))
  await fs.writeFile(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ auth: { username: ADMIN.username, password: ADMIN.password } }, null, 2)
  )
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }, null, 2))
  const webDistDir = path.join(dataDir, 'webdist')
  await fs.mkdir(path.join(webDistDir, 'assets'), { recursive: true })
  await fs.writeFile(
    path.join(webDistDir, 'index.html'),
    '<!doctype html><html><body>edgeone domain handler probe</body></html>\n'
  )

  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    webDistDir,
    sessionSecret: SESSION_SECRET,
    sessionCookieName: 'dns_pro_eo_domain',
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

type UpstreamCall = { action: string; payload: Record<string, unknown>; secretId: string }

type StubState = {
  domains: Array<Record<string, unknown>>
  calls: UpstreamCall[]
  listError: Error | null
  mutationError: Error | null
  mutationResult: Record<string, unknown>
}

/** 变更类 Action 白名单：写错 Action 名的桩会立即抛错，而不是静默返回一个空响应 */
const MUTATION_ACTIONS = new Set([
  'ModifyAccelerationDomain',
  'ModifyAccelerationDomainStatuses',
  'ModifyHostsCertificate',
])

const state: StubState = {
  domains: [],
  calls: [],
  listError: null,
  mutationError: null,
  mutationResult: { RequestId: 'req-mutate' },
}

/**
 * EdgeOne 上游桩：记录 Action / 载荷 / 本次调用使用的腾讯云 SecretId。
 * 记录 SecretId 是「URL 上的 providerId 真的参与了解析」的可观测证据——EdgeOne 请求体里没有 ProviderId。
 */
function installStub(): void {
  EdgeOneClient.prototype.call = async function (
    this: EdgeOneClient,
    action: string,
    payload: Record<string, unknown> = {}
  ) {
    const credentials = (this as unknown as { credentials: { secretId: string } }).credentials
    state.calls.push({ action, payload, secretId: credentials.secretId })
    if (action === 'DescribeAccelerationDomains') {
      if (state.listError) throw state.listError
      return {
        AccelerationDomains: state.domains,
        TotalCount: state.domains.length,
        RequestId: 'req-domain-list',
      }
    }
    if (!MUTATION_ACTIONS.has(action)) throw new Error(`unexpected EdgeOne action: ${action}`)
    if (state.mutationError) throw state.mutationError
    return state.mutationResult
  }
}

const originalEdgeOneCall = EdgeOneClient.prototype.call

/** 上游返回的加速域名原始形状（presentDomain 之外的键不会进入响应） */
function probeDomain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ZoneId: 'zone-domains',
    DomainName: 'www.example.com',
    DomainStatus: 'online',
    Cname: 'www.example.com.eo.dnse5.com',
    IPv6Status: 'follow',
    IdentificationStatus: 'finished',
    OriginProtocol: 'HTTPS',
    HttpOriginPort: 80,
    HttpsOriginPort: 443,
    OriginDetail: { OriginType: 'IP_DOMAIN', Origin: '192.0.2.1', HostHeader: 'origin.example.com' },
    Certificate: {
      Mode: 'sslcert',
      List: [
        {
          CertId: 'cert-1',
          Alias: 'edge-cert',
          Type: 'managed',
          Status: 'deployed',
          ExpireTime: '2027-01-01T00:00:00Z',
        },
      ],
    },
    CreatedOn: '2026-01-02T00:00:00Z',
    ModifiedOn: '2026-02-03T00:00:00Z',
    ...overrides,
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
    id: 'edge-dns',
    name: 'EdgeOne linked DNSPod',
    type: 'dnspod',
    secret_id: 'edge-secret-id',
    secret_key: 'edge-key',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'edge-owner',
    name: 'EdgeOne owner',
    type: 'edgeone',
    dnspod_provider: 'edge-dns',
  })
})

afterAll(async () => {
  EdgeOneClient.prototype.call = originalEdgeOneCall
  await app.close()
})

beforeEach(() => {
  state.domains = []
  state.calls = []
  state.listError = null
  state.mutationError = null
  state.mutationResult = { RequestId: 'req-mutate' }
})

const recordsUrl = (zoneId: string) => `/api/edgeone/providers/edge-owner/zones/${zoneId}/records`
const domainUrl = (zoneId: string, domainName: string) => `${recordsUrl(zoneId)}/${domainName}`

const getRecords = (zoneId: string, refresh = false) =>
  app.inject({
    method: 'GET',
    url: `${recordsUrl(zoneId)}${refresh ? '?refresh=true' : ''}`,
    headers: { cookie: sessionCookie },
  })

const putJson = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url, headers: { cookie: sessionCookie }, payload })

describe('加速域名列表 GET /zones/:zoneId/records', () => {
  it('返回归一后的加速域名字段（含 origin / certificate 嵌套），上游载荷带 zoneId 与分页参数', async () => {
    state.domains = [probeDomain(), { ZoneId: 'zone-domains', DomainName: 'minimal.example.com' }]

    const response = await getRecords('zone-domains', true)

    expect(response.statusCode, response.body).toBe(200)
    const body = response.json()
    expect(body.code).toBe(0)
    expect(body.data.request_id).toBe('req-domain-list')
    expect(body.data.items).toEqual([
      {
        zone_id: 'zone-domains',
        name: 'www.example.com',
        status: 'online',
        cname: 'www.example.com.eo.dnse5.com',
        ipv6_status: 'follow',
        identification_status: 'finished',
        origin_protocol: 'HTTPS',
        http_origin_port: 80,
        https_origin_port: 443,
        origin: { type: 'IP_DOMAIN', value: '192.0.2.1', host_header: 'origin.example.com' },
        certificate: {
          mode: 'sslcert',
          items: [
            {
              cert_id: 'cert-1',
              alias: 'edge-cert',
              type: 'managed',
              status: 'deployed',
              expire_time: '2027-01-01T00:00:00Z',
            },
          ],
        },
        created_on: '2026-01-02T00:00:00Z',
        modified_on: '2026-02-03T00:00:00Z',
      },
      {
        // 上游字段缺失时回落为 undefined / 空证书列表，而不是把原始键漏出去
        zone_id: 'zone-domains',
        name: 'minimal.example.com',
        status: undefined,
        cname: undefined,
        ipv6_status: undefined,
        identification_status: undefined,
        origin_protocol: undefined,
        http_origin_port: undefined,
        https_origin_port: undefined,
        origin: { type: undefined, value: undefined, host_header: undefined },
        certificate: { mode: 'disable', items: [] },
        created_on: undefined,
        modified_on: undefined,
      },
    ])
    expect(body.data.pagination).toEqual({
      page: 1,
      per_page: 2,
      offset: 0,
      limit: 2,
      count: 2,
      total: 2,
      total_count: 2,
      total_pages: 1,
    })
    expect(state.calls).toEqual([
      {
        action: 'DescribeAccelerationDomains',
        payload: { ZoneId: 'zone-domains', Offset: 0, Limit: 100 },
        secretId: 'edge-secret-id',
      },
    ])
  })

  it('站点没有加速域名时返回空数组而不是错误', async () => {
    const response = await getRecords('zone-empty', true)

    expect(response.statusCode, response.body).toBe(200)
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

  it('refresh=true 每次回源；缺省读取命中缓存不再打上游', async () => {
    state.domains = [probeDomain()]

    const warm = await getRecords('zone-cache', true)
    expect(warm.statusCode, warm.body).toBe(200)
    expect(state.calls).toHaveLength(1)

    const cached = await getRecords('zone-cache')
    expect(cached.statusCode, cached.body).toBe(200)
    expect(cached.json().data.items).toEqual(warm.json().data.items)
    expect(state.calls, '缺省 refresh 应命中缓存').toHaveLength(1)

    // 上游数据变化在缓存存活期内不可见，只有 refresh=true 才能拿到新快照
    state.domains = [probeDomain(), probeDomain({ DomainName: 'second.example.com' })]
    const stale = await getRecords('zone-cache')
    expect(stale.json().data.items).toHaveLength(1)

    const refreshed = await getRecords('zone-cache', true)
    expect(refreshed.json().data.items.map((domain: { name: string }) => domain.name)).toEqual([
      'www.example.com',
      'second.example.com',
    ])
    expect(state.calls).toHaveLength(2)
  })

  it('providerId 不存在时返回 404 edgeone_provider_not_found，且不触上游', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/edgeone/providers/ghost/zones/zone-domains/records?refresh=true',
      headers: { cookie: sessionCookie },
    })

    expect(response.statusCode, response.body).toBe(404)
    expect(response.json()).toEqual({
      message: 'EdgeOne 服务商不存在',
      code: 'edgeone_provider_not_found',
      status: 404,
    })
    expect(state.calls).toEqual([])
  })

  it('上游抛非 ApiError → 502 edgeone_domain_list_failed', async () => {
    state.listError = new Error('ECONNRESET')

    const response = await getRecords('zone-list-fail', true)

    expect(response.statusCode, response.body).toBe(502)
    const body = response.json()
    expect(body.code).toBe('edgeone_domain_list_failed')
    expect(body.status).toBe(502)
    expect(body.details).toEqual({ provider_id: 'edge-owner' })
  })
})

describe('加速域名更新 PUT /zones/:zoneId/records/:domainName', () => {
  it('路径域名归一为小写并优先于请求体，全字段按 update 语义下发', async () => {
    const response = await putJson(domainUrl('zone-update', 'WWW.Example.COM'), {
      domain_name: 'body.example.com',
      origin: ' 192.0.2.9 ',
      origin_type: 'IP_DOMAIN',
      host_header: 'ORIGIN.example.com',
      origin_protocol: 'HTTPS',
      http_origin_port: 8080,
      https_origin_port: 8443,
      ipv6_status: 'on',
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ name: 'www.example.com', request_id: 'req-mutate' })
    expect(state.calls).toEqual([
      {
        action: 'ModifyAccelerationDomain',
        payload: {
          ZoneId: 'zone-update',
          DomainName: 'www.example.com',
          OriginInfo: { OriginType: 'IP_DOMAIN', Origin: '192.0.2.9', HostHeader: 'origin.example.com' },
          OriginProtocol: 'HTTPS',
          IPv6Status: 'on',
          // HTTPS 回源不下发 HTTP 端口（只带显式提供的字段）
          HttpsOriginPort: 8443,
        },
        secretId: 'edge-secret-id',
      },
    ])
  })

  it('只改源站时不下发未提供字段，避免把回源协议/端口/IPv6 静默重置', async () => {
    const response = await putJson(domainUrl('zone-minimal', 'minimal.example.com'), { origin: '192.0.2.20' })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ name: 'minimal.example.com', request_id: 'req-mutate' })
    expect(state.calls[0]?.payload).toEqual({
      ZoneId: 'zone-minimal',
      DomainName: 'minimal.example.com',
      OriginInfo: { Origin: '192.0.2.20' },
    })
  })

  it('显式空串 host_header 必须原样下发（清空自定义回源 HOST 不能被省略）', async () => {
    const response = await putJson(domainUrl('zone-host', 'host.example.com.'), {
      origin: '192.0.2.30',
      host_header: '',
    })

    expect(response.statusCode, response.body).toBe(200)
    // 尾点同样属于路径域名归一的一部分
    expect(response.json().data.name).toBe('host.example.com')
    expect(state.calls[0]?.payload).toEqual({
      ZoneId: 'zone-host',
      DomainName: 'host.example.com',
      OriginInfo: { Origin: '192.0.2.30', HostHeader: '' },
    })
  })

  it('更新成功后站点加速域名缓存失效，下一次列表读取必须回源', async () => {
    state.domains = [probeDomain()]
    expect((await getRecords('zone-invalidate', true)).statusCode).toBe(200)
    expect(state.calls).toHaveLength(1)

    const update = await putJson(domainUrl('zone-invalidate', 'www.example.com'), { origin: '192.0.2.40' })
    expect(update.statusCode, update.body).toBe(200)

    const afterUpdate = await getRecords('zone-invalidate')
    expect(afterUpdate.statusCode, afterUpdate.body).toBe(200)
    expect(state.calls.map((call) => call.action)).toEqual([
      'DescribeAccelerationDomains',
      'ModifyAccelerationDomain',
      'DescribeAccelerationDomains',
    ])
  })

  it('请求体缺字段或取值非法 → 400 validation_error，且不触上游', async () => {
    const rejectedPayloads: Array<{ title: string; payload: Record<string, unknown> }> = [
      { title: '缺 origin', payload: { origin_type: 'IP_DOMAIN' } },
      { title: 'origin 为空串', payload: { origin: '' } },
      { title: 'origin_protocol 小写', payload: { origin: '192.0.2.1', origin_protocol: 'https' } },
      { title: 'ipv6_status 非法', payload: { origin: '192.0.2.1', ipv6_status: 'auto' } },
      { title: 'http_origin_port 越界', payload: { origin: '192.0.2.1', http_origin_port: 0 } },
    ]

    for (const { title, payload } of rejectedPayloads) {
      const response = await putJson(domainUrl('zone-reject', 'reject.example.com'), payload)
      expect(response.statusCode, `${title} => ${response.body}`).toBe(400)
      expect(response.json().code, title).toBe('validation_error')
    }
    expect(state.calls, '校验失败的请求不得触上游').toEqual([])
  })

  it('上游抛非 ApiError → 502 edgeone_domain_update_failed（载荷已按请求下发）', async () => {
    state.mutationError = new Error('socket hang up')

    const response = await putJson(domainUrl('zone-update-fail', 'fail.example.com'), { origin: '192.0.2.50' })

    expect(response.statusCode, response.body).toBe(502)
    const body = response.json()
    expect(body.code).toBe('edgeone_domain_update_failed')
    expect(body.status).toBe(502)
    expect(state.calls[0]?.payload).toEqual({
      ZoneId: 'zone-update-fail',
      DomainName: 'fail.example.com',
      OriginInfo: { Origin: '192.0.2.50' },
    })
  })

  it('上游变更响应缺 RequestId → 502 edgeone_invalid_response（不得当成功返回）', async () => {
    state.mutationResult = {}

    const response = await putJson(domainUrl('zone-invalid', 'invalid.example.com'), { origin: '192.0.2.60' })

    expect(response.statusCode, response.body).toBe(502)
    expect(response.json().code).toBe('edgeone_invalid_response')
  })
})

describe('加速域名启停 PUT /zones/:zoneId/records/:domainName/status', () => {
  it('状态与归一化域名按请求下发，响应回显状态', async () => {
    const response = await putJson(`${domainUrl('zone-status', 'WWW.Example.com')}/status`, { status: 'offline' })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      name: 'www.example.com',
      status: 'offline',
      request_id: 'req-mutate',
    })
    expect(state.calls).toEqual([
      {
        action: 'ModifyAccelerationDomainStatuses',
        payload: {
          ZoneId: 'zone-status',
          DomainNames: ['www.example.com'],
          Status: 'offline',
          Force: false,
        },
        secretId: 'edge-secret-id',
      },
    ])
  })

  it('status 取值非法 → 400 validation_error，且不触上游', async () => {
    const response = await putJson(`${domainUrl('zone-status', 'www.example.com')}/status`, { status: 'paused' })

    expect(response.statusCode, response.body).toBe(400)
    expect(response.json().code).toBe('validation_error')
    expect(state.calls).toEqual([])
  })

  it('上游失败 → 502 edgeone_domain_status_failed', async () => {
    state.mutationError = new ApiError('edgeone_request_failed', 'EdgeOne API error: InvalidParameter', 502)

    const response = await putJson(`${domainUrl('zone-status', 'www.example.com')}/status`, { status: 'online' })

    expect(response.statusCode, response.body).toBe(502)
    // 已是 ApiError 时不二次包装：上游错误码与文案原样透出，便于定位
    expect(response.json().code).toBe('edgeone_request_failed')
    expect(response.json().status).toBe(502)
  })
})

describe('加速域名证书 PUT /zones/:zoneId/records/:domainName/certificate', () => {
  it('免费证书：只下发 Mode，不带 ServerCertInfo', async () => {
    const response = await putJson(`${domainUrl('zone-cert', 'cert.example.com')}/certificate`, {
      https_mode: 'eofreecert',
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      name: 'cert.example.com',
      https_mode: 'eofreecert',
      request_id: 'req-mutate',
    })
    expect(state.calls).toEqual([
      {
        action: 'ModifyHostsCertificate',
        payload: { ZoneId: 'zone-cert', Hosts: ['cert.example.com'], Mode: 'eofreecert' },
        secretId: 'edge-secret-id',
      },
    ])
  })

  it('指定证书：cert_id 进入 ServerCertInfo', async () => {
    const response = await putJson(`${domainUrl('zone-cert', 'www.example.com')}/certificate`, {
      https_mode: 'sslcert',
      cert_id: 'cert-abc_1',
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      name: 'www.example.com',
      https_mode: 'sslcert',
      request_id: 'req-mutate',
    })
    expect(state.calls[0]?.payload).toEqual({
      ZoneId: 'zone-cert',
      Hosts: ['www.example.com'],
      Mode: 'sslcert',
      ServerCertInfo: [{ CertId: 'cert-abc_1' }],
    })
  })

  it('sslcert 缺 cert_id → 422 validation_failed，且不触上游', async () => {
    const response = await putJson(`${domainUrl('zone-cert', 'www.example.com')}/certificate`, {
      https_mode: 'sslcert',
    })

    expect(response.statusCode, response.body).toBe(422)
    const body = response.json()
    expect(body.code).toBe('validation_failed')
    expect(body.status).toBe(422)
    expect(state.calls, '缺 CertId 的证书切换不得触上游').toEqual([])
  })

  it('https_mode 取值非法 → 400 validation_error', async () => {
    const response = await putJson(`${domainUrl('zone-cert', 'www.example.com')}/certificate`, {
      https_mode: 'auto',
    })

    expect(response.statusCode, response.body).toBe(400)
    expect(response.json().code).toBe('validation_error')
    expect(state.calls).toEqual([])
  })

  it('上游失败 → 502 edgeone_domain_certificate_failed', async () => {
    state.mutationError = new Error('certificate service unavailable')

    const response = await putJson(`${domainUrl('zone-cert', 'www.example.com')}/certificate`, {
      https_mode: 'disable',
    })

    expect(response.statusCode, response.body).toBe(502)
    const body = response.json()
    expect(body.code).toBe('edgeone_domain_certificate_failed')
    expect(body.status).toBe(502)
    expect(state.calls).toHaveLength(1)
  })
})
