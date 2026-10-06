import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CloudflareClient } from '../cloudflare.client.js'
import { ApiError } from '../../../core/http/api-error.js'
import { buildTestApp, cookieLineOf, makeTempDataDir } from '../../../app/test-helpers.js'

/**
 * SaaS 读接口的路由层：站点列表 / 主机名列表 / 主机名详情 / 默认回源（GET / PUT / DELETE）。
 *
 * handler 只做「路径参数 → 服务实参」的透传，所以这层盯的是：HTTP 状态码、响应体 `data` 字段、
 * 真正发给上游的实参（providerId → 关联 Cloudflare 服务商、zoneName → 站点名过滤与站点 ID、
 * hostnameFqdn → 主机名 ID、origin → PUT 载荷）以及失败路径的错误码。
 * 远端合并、偏好事务等语义由同目录 service 测试覆盖，这里只作端点级回归。
 *
 * 上游一律走 CloudflareClient 原型桩：未注册的「METHOD path」直接抛错，绝不发真实网络请求。
 */

const OWNER = { username: 'owner', password: 'saas-handler-password' }

type UpstreamCall = { method: string; path: string; params?: Record<string, unknown>; data?: unknown }
type UpstreamBody = Record<string, unknown>
type UpstreamRoute = UpstreamBody | ((call: UpstreamCall) => UpstreamBody)

let app: FastifyInstance
let sessionCookie = ''

const originalCloudflareMethods = {
  get: CloudflareClient.prototype.get,
  post: CloudflareClient.prototype.post,
  put: CloudflareClient.prototype.put,
  patch: CloudflareClient.prototype.patch,
  delete: CloudflareClient.prototype.delete,
}

/**
 * 假上游：按「METHOD path」注册应答，逐次记录调用实参。
 * 未注册的请求立即抛错——静默吞掉多余请求会让「handler 少调 / 错调上游」这类回归变成通过。
 */
function stubUpstream(routes: Record<string, UpstreamRoute>): UpstreamCall[] {
  const calls: UpstreamCall[] = []
  const handle = (method: string, path: string, params?: Record<string, unknown>, data?: unknown): UpstreamBody => {
    const call: UpstreamCall = { method, path, params, data }
    calls.push(call)
    const route = routes[`${method} ${path}`]
    if (route === undefined) throw new Error(`Unexpected fake Cloudflare ${method} ${path}`)
    return typeof route === 'function' ? route(call) : route
  }

  CloudflareClient.prototype.get = (async (path: string, params?: Record<string, unknown>) =>
    handle('GET', path, params)) as never
  CloudflareClient.prototype.post = (async (path: string, data?: unknown) =>
    handle('POST', path, undefined, data)) as never
  CloudflareClient.prototype.put = (async (path: string, data?: unknown) =>
    handle('PUT', path, undefined, data)) as never
  CloudflareClient.prototype.patch = (async (path: string, data?: unknown) =>
    handle('PATCH', path, undefined, data)) as never
  CloudflareClient.prototype.delete = (async (path: string) => handle('DELETE', path)) as never

  return calls
}

/** 上游 404：与 BaseHttpClient 的真实形态一致（http_error + details.upstream_status） */
const upstreamNotFound = (): UpstreamBody => {
  throw new ApiError('http_error', 'Provider API error: 404 Not Found', 400, { upstream_status: 404 })
}

const upstreamDown = (): UpstreamBody => {
  throw new Error('fake upstream connection refused')
}

const zoneRow = (zone: { id: string; name: string }): UpstreamBody => ({
  id: zone.id,
  name: zone.name,
  status: 'active',
  paused: false,
  name_servers: ['ada.ns.cloudflare.com'],
  original_name_servers: ['ada.ns.cloudflare.com'],
  account: { id: 'acc-1' },
})

/** 站点分页：与真实上游同构地支持 name 精确过滤（idByName 靠它把站点名解析成站点 ID） */
function zonesRoute(zones: () => Array<{ id: string; name: string }>): UpstreamRoute {
  return (call) => {
    const name = String(call.params?.name ?? '')
    const matched = name === '' ? zones() : zones().filter((zone) => zone.name === name)
    return {
      success: true,
      result: matched.map(zoneRow),
      result_info: {
        page: Number(call.params?.page ?? 1),
        per_page: 100,
        total_count: matched.length,
        total_pages: 1,
      },
    }
  }
}

const hostnameRow = (id: string, hostname: string, extra: UpstreamBody = {}): UpstreamBody => ({
  id,
  hostname,
  status: 'active',
  ssl: { method: 'http', status: 'active' },
  ...extra,
})

function hostnamesRoute(hostnames: () => UpstreamBody[]): UpstreamRoute {
  return () => ({
    success: true,
    result: hostnames(),
    result_info: { page: 1, per_page: 100, total_count: hostnames().length, total_pages: 1 },
  })
}

/** 每个用例一套独立服务商：providerId 进缓存键，站点/主机名快照不会跨用例串味 */
async function createSaasProvider(key: string): Promise<string> {
  const cloudflareProviderId = `cf-${key}`
  await app.ctx.workflows.providerManagement.create({
    id: cloudflareProviderId,
    name: `CF ${key}`,
    type: 'cloudflare',
    api_token: `token-${key}`,
  })
  const saasProviderId = `saas-${key}`
  await app.ctx.workflows.providerManagement.create({
    id: saasProviderId,
    name: `SaaS ${key}`,
    type: 'saas',
    cloudflare_provider: cloudflareProviderId,
    dnspod_provider: 'dns-target',
  })
  return saasProviderId
}

const zonesUrl = (providerId: string) => `/api/saas/providers/${providerId}/zones`
const hostnamesUrl = (providerId: string, zoneName: string) =>
  `/api/saas/providers/${providerId}/zones/${zoneName}/hostnames`
const hostnameUrl = (providerId: string, zoneName: string, fqdn: string) =>
  `${hostnamesUrl(providerId, zoneName)}/${fqdn}`
const fallbackUrl = (providerId: string, zoneName: string) =>
  `/api/saas/providers/${providerId}/zones/${zoneName}/fallback-origin`

const authorized = (options: InjectOptions) => app.inject({ ...options, headers: { cookie: sessionCookie } })

beforeAll(async () => {
  const dataDir = await makeTempDataDir('dns-pro-saas-handlers-')
  await fs.writeFile(path.join(dataDir, 'config.json'), `${JSON.stringify({ auth: OWNER }, null, 2)}\n`)
  app = await buildTestApp(dataDir)
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: OWNER })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieLineOf(login)

  await app.ctx.workflows.providerManagement.create({
    id: 'dns-target',
    name: 'DNSPod target',
    type: 'dnspod',
    secret_id: 'handler-secret-id',
    secret_key: 'handler-secret-key',
  })
})

afterEach(() => {
  CloudflareClient.prototype.get = originalCloudflareMethods.get
  CloudflareClient.prototype.post = originalCloudflareMethods.post
  CloudflareClient.prototype.put = originalCloudflareMethods.put
  CloudflareClient.prototype.patch = originalCloudflareMethods.patch
  CloudflareClient.prototype.delete = originalCloudflareMethods.delete
})

afterAll(async () => {
  await app.close()
})

describe('SaaS 读接口的鉴权作用域', () => {
  it('六个端点都在鉴权作用域内：匿名请求一律 401', async () => {
    const urls = [
      zonesUrl('saas-anonymous'),
      hostnamesUrl('saas-anonymous', 'example.com'),
      hostnameUrl('saas-anonymous', 'example.com', 'www.example.com'),
      fallbackUrl('saas-anonymous', 'example.com'),
    ]
    for (const url of urls) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401)
    }
    expect((await app.inject({ method: 'PUT', url: urls[3], payload: { origin: 'a.example.com' } })).statusCode).toBe(
      401
    )
    expect((await app.inject({ method: 'DELETE', url: urls[3] })).statusCode).toBe(401)
  })
})

describe('GET /zones：站点列表与 refresh 透传', () => {
  it('refresh=false 命中缓存、refresh=true 强制重拉，响应带 items 与分页元数据', async () => {
    const providerId = await createSaasProvider('zones')
    let zones = [{ id: 'zone-1', name: 'example.com' }]
    const calls = stubUpstream({ 'GET zones': zonesRoute(() => zones) })

    const first = await authorized({ method: 'GET', url: zonesUrl(providerId) })
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json().data.items[0]).toMatchObject({ id: 'zone-1', name: 'example.com', status: 'active' })
    expect(first.json().data.pagination.total).toBe(1)

    zones = [
      { id: 'zone-1', name: 'example.com' },
      { id: 'zone-2', name: 'other.com' },
    ]
    const cached = await authorized({ method: 'GET', url: zonesUrl(providerId) })
    expect(cached.json().data.items).toHaveLength(1)

    const refreshed = await authorized({ method: 'GET', url: `${zonesUrl(providerId)}?refresh=true` })
    expect(refreshed.json().data.items.map((item: { id: string }) => item.id)).toEqual(['zone-1', 'zone-2'])

    // 三次请求只打上游两次：无 refresh 的第二次没透传成强制重拉，带 refresh 的第三次透传到了上游
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ method: 'GET', path: 'zones', params: { page: 1, per_page: 100 } })
  })

  it('上游失败：502 且错误码指向站点列表，不得伪装成空列表', async () => {
    const providerId = await createSaasProvider('zones-failed')
    stubUpstream({ 'GET zones': upstreamDown })

    const response = await authorized({ method: 'GET', url: zonesUrl(providerId) })
    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('cloudflare_zone_list_failed')
  })
})

describe('GET /zones/:zoneName/hostnames：主机名列表', () => {
  it('zoneName 解析成站点 ID 后拉列表，逐条合并生效同步配置', async () => {
    const providerId = await createSaasProvider('list')
    const calls = stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'GET zones/zone-1/custom_hostnames': hostnamesRoute(() => [
        hostnameRow('h-1', 'www.example.com', { custom_origin_server: 'origin.example.com' }),
        hostnameRow('h-2', 'api.example.com'),
      ]),
    })

    const response = await authorized({ method: 'GET', url: hostnamesUrl(providerId, 'example.com') })
    expect(response.statusCode, response.body).toBe(200)

    const data = response.json().data
    expect(data.items.map((item: { id: string }) => item.id)).toEqual(['h-1', 'h-2'])
    expect(data.items[0]).toMatchObject({
      hostname: 'www.example.com',
      status: 'active',
      custom_origin_server: 'origin.example.com',
      effective_sync_target: 'dnspod',
      effective_sync_provider_id: 'dns-target',
      effective_sync_zone: 'example.com',
    })
    expect(data.pagination.total).toBe(2)

    // providerId 走路径 → 关联的 Cloudflare 服务商；zoneName 既作上游 name 过滤，又是列表路径里的站点 ID 来源
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: 'zones',
      params: { page: 1, per_page: 100, name: 'example.com' },
    })
    expect(calls[1]).toMatchObject({ method: 'GET', path: 'zones/zone-1/custom_hostnames' })
  })

  it('站点不在账号内：404 cloudflare_zone_not_found，且不去拉主机名列表', async () => {
    const providerId = await createSaasProvider('list-missing-zone')
    const calls = stubUpstream({ 'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'other.com' }]) })

    const response = await authorized({ method: 'GET', url: hostnamesUrl(providerId, 'example.com') })
    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe('cloudflare_zone_not_found')
    expect(calls.map((call) => call.path)).toEqual(['zones'])
  })
})

describe('GET /zones/:zoneName/hostnames/:hostnameFqdn：主机名详情', () => {
  it('按 FQDN 解析出主机名 ID 再取详情，DCV 委派 UUID 取自主机名', async () => {
    const providerId = await createSaasProvider('detail')
    const calls = stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'GET zones/zone-1/custom_hostnames': hostnamesRoute(() => [hostnameRow('h-1', 'www.example.com')]),
      'GET zones/zone-1/custom_hostnames/h-1': {
        success: true,
        result: {
          id: 'h-1',
          hostname: 'www.example.com',
          status: 'active',
          custom_origin_server: 'origin.example.com',
          ssl: { method: 'http', status: 'active', dcv_delegation_uuid: 'hostname-dcv-uuid' },
          ownership_verification: { type: 'txt', name: '_cf-custom-hostname.www.example.com', value: 'verify-token' },
        },
      },
    })

    const response = await authorized({
      method: 'GET',
      url: hostnameUrl(providerId, 'example.com', 'www.example.com'),
    })
    expect(response.statusCode, response.body).toBe(200)

    const data = response.json().data
    expect(data).toMatchObject({
      id: 'h-1',
      hostname: 'www.example.com',
      custom_origin_server: 'origin.example.com',
      effective_sync_target: 'dnspod',
      effective_sync_provider_id: 'dns-target',
    })
    expect(data.ssl.dcv_delegation_uuid).toBe('hostname-dcv-uuid')
    expect(data.ownership_verification.value).toBe('verify-token')

    // FQDN 路径参数经站点快照换成主机名 ID：详情走的是 h-1，不是原样把 FQDN 拼进上游路径
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET zones',
      'GET zones/zone-1/custom_hostnames',
      'GET zones/zone-1/custom_hostnames/h-1',
    ])
  })

  it('详情 404：主机名不在站点内时返回 404，且不请求不存在的详情路径', async () => {
    const providerId = await createSaasProvider('detail-missing')
    const calls = stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'GET zones/zone-1/custom_hostnames': hostnamesRoute(() => [hostnameRow('h-1', 'www.example.com')]),
    })

    const response = await authorized({
      method: 'GET',
      url: hostnameUrl(providerId, 'example.com', 'missing.example.com'),
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().code).toBe('saas_hostname_not_found')
    // 快照未命中后强制刷新确认一次，两次都是主机名列表；详情路径一次都没被打
    expect(calls.map((call) => call.path)).toEqual([
      'zones',
      'zones/zone-1/custom_hostnames',
      'zones/zone-1/custom_hostnames',
    ])
  })

  it('主机名没带 DCV UUID 时回落到站点级，站点级查询失败不阻断详情，refresh 透传到详情与兜底查询', async () => {
    const providerId = await createSaasProvider('detail-dcv')
    let dcvFails = true
    const calls = stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'GET zones/zone-1/custom_hostnames': hostnamesRoute(() => [hostnameRow('h-1', 'www.example.com')]),
      'GET zones/zone-1/custom_hostnames/h-1': {
        success: true,
        result: { id: 'h-1', hostname: 'www.example.com', status: 'active', ssl: { method: 'http' } },
      },
      'GET zones/zone-1/dcv_delegation/uuid': () =>
        dcvFails ? upstreamNotFound() : { success: true, result: { uuid: 'zone-dcv-uuid' } },
    })
    const url = hostnameUrl(providerId, 'example.com', 'www.example.com')

    const degraded = await authorized({ method: 'GET', url })
    expect(degraded.statusCode, degraded.body).toBe(200)
    expect(degraded.json().data.ssl.dcv_delegation_uuid).toBe('')

    dcvFails = false
    const refreshed = await authorized({ method: 'GET', url: `${url}?refresh=true` })
    expect(refreshed.statusCode, refreshed.body).toBe(200)
    expect(refreshed.json().data.ssl.dcv_delegation_uuid).toBe('zone-dcv-uuid')
    expect(calls.filter((call) => call.path.endsWith('/dcv_delegation/uuid'))).toHaveLength(2)
  })
})

describe('默认回源：GET / PUT / DELETE', () => {
  it('GET 读取默认回源；refresh=true 时上游 404 视为「未设置」而不是故障', async () => {
    const providerId = await createSaasProvider('fallback-get')
    let configured = true
    const calls = stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'GET zones/zone-1/custom_hostnames/fallback_origin': () =>
        configured ? { success: true, result: { origin: 'origin.example.com', status: 'active' } } : upstreamNotFound(),
    })
    const url = fallbackUrl(providerId, 'example.com')

    const read = await authorized({ method: 'GET', url })
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json().data).toEqual({ origin: 'origin.example.com', status: 'active' })

    configured = false
    const refreshed = await authorized({ method: 'GET', url: `${url}?refresh=true` })
    expect(refreshed.statusCode, refreshed.body).toBe(200)
    expect(refreshed.json().data).toEqual({ origin: null, status: null })

    expect(calls.filter((call) => call.path.endsWith('/fallback_origin'))).toHaveLength(2)
  })

  it('PUT 把 origin 归一化后按站点 ID 发给上游，返回上游结果', async () => {
    const providerId = await createSaasProvider('fallback-put')
    const calls = stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'PUT zones/zone-1/custom_hostnames/fallback_origin': {
        success: true,
        result: { origin: 'new-origin.example.com', status: 'pending' },
      },
    })

    const response = await authorized({
      method: 'PUT',
      url: fallbackUrl(providerId, 'example.com'),
      payload: { origin: 'New-Origin.Example.com.' },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ origin: 'new-origin.example.com', status: 'pending' })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ method: 'GET', path: 'zones', params: { name: 'example.com' } })
    expect(calls[1]).toMatchObject({
      method: 'PUT',
      path: 'zones/zone-1/custom_hostnames/fallback_origin',
      data: { origin: 'new-origin.example.com' },
    })
  })

  it('PUT 的 origin 不属于该站点：422 且一个上游请求都不发', async () => {
    const providerId = await createSaasProvider('fallback-put-invalid')
    const calls = stubUpstream({})

    const response = await authorized({
      method: 'PUT',
      url: fallbackUrl(providerId, 'example.com'),
      payload: { origin: 'origin.other.net' },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json().code).toBe('fallback_origin_invalid')
    expect(calls).toHaveLength(0)
  })

  it('PUT 缺 origin 字段：400 参数校验失败', async () => {
    const providerId = await createSaasProvider('fallback-put-schema')
    stubUpstream({})

    const response = await authorized({
      method: 'PUT',
      url: fallbackUrl(providerId, 'example.com'),
      payload: {},
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('validation_error')
    expect(response.json().details.errors).toHaveProperty('origin')
  })

  it('PUT 上游失败：502 且错误码指向默认回源写入', async () => {
    const providerId = await createSaasProvider('fallback-put-failed')
    stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'PUT zones/zone-1/custom_hostnames/fallback_origin': upstreamDown,
    })

    const response = await authorized({
      method: 'PUT',
      url: fallbackUrl(providerId, 'example.com'),
      payload: { origin: 'origin.example.com' },
    })
    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('saas_fallback_origin_set_failed')
  })

  it('DELETE 清空默认回源：200 + 空值结果，并按站点 ID 删除', async () => {
    const providerId = await createSaasProvider('fallback-delete')
    const calls = stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'DELETE zones/zone-1/custom_hostnames/fallback_origin': {
        success: true,
        result: { origin: 'origin.example.com' },
      },
    })

    const response = await authorized({ method: 'DELETE', url: fallbackUrl(providerId, 'example.com') })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({ origin: null, status: null })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET zones',
      'DELETE zones/zone-1/custom_hostnames/fallback_origin',
    ])
  })

  it('DELETE 上游失败：502 且错误码指向默认回源删除', async () => {
    const providerId = await createSaasProvider('fallback-delete-failed')
    stubUpstream({
      'GET zones': zonesRoute(() => [{ id: 'zone-1', name: 'example.com' }]),
      'DELETE zones/zone-1/custom_hostnames/fallback_origin': upstreamDown,
    })

    const response = await authorized({ method: 'DELETE', url: fallbackUrl(providerId, 'example.com') })
    expect(response.statusCode).toBe(502)
    expect(response.json().code).toBe('saas_fallback_origin_delete_failed')
  })
})
