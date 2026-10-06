import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './lifecycle.js'
import type { AppConfig } from './config.js'
import { CloudflareClient } from '../modules/cloudflare/cloudflare.client.js'
import { ApiError } from '../core/http/api-error.js'

/**
 * 迁移自 scripts/isolated-api-probe.ts 的服务商 CRUD 与关联部分：
 * 定义清单 / 删除的引用保护 / 关联服务商响应一致性 / SaaS 主机名创建与删除的偏好策略 /
 * Cloudflared 隧道令牌副作用与关联缓存失效。
 * 上游一律走客户端原型桩，不发真实网络请求。
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let app: FastifyInstance
let sessionCookie = ''

const originalCloudflareGet = CloudflareClient.prototype.get
const originalCloudflarePost = CloudflareClient.prototype.post

afterEach(() => {
  CloudflareClient.prototype.get = originalCloudflareGet
  CloudflareClient.prototype.post = originalCloudflarePost
})

beforeAll(async () => {
  const started = await startApp()
  app = started.app
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieOf(login)

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

describe('服务商定义与数据目录初值', () => {
  it('新数据目录下 providers 列表为空', async () => {
    const started = await startApp()
    try {
      const login = await started.app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
      expect(login.statusCode).toBe(200)
      const providers = await started.app.inject({
        method: 'GET',
        url: '/api/providers',
        headers: { cookie: cookieOf(login) },
      })
      expect(providers.statusCode).toBe(200)
      expect(providers.json().data).toEqual([])
    } finally {
      await started.app.close()
    }
  })

  it('definitions 返回全部 5 类服务商定义', async () => {
    const definitions = await app.inject({
      method: 'GET',
      url: '/api/providers/definitions',
      headers: { cookie: sessionCookie },
    })
    expect(definitions.statusCode).toBe(200)
    expect(Array.isArray(definitions.json().data)).toBe(true)
    expect(definitions.json().data.length).toBe(5)
  })
})

describe('服务商删除的引用完整性', () => {
  it('被 SaaS 偏好引用的归属方与同步目标都受删除保护', async () => {
    const preferenceOwnerId = 'cf-owner'
    const preferenceHostnameId = 'hostname-1'
    const ownerLookupReached = deferred<void>()
    const preferenceGate = deferred<void>()
    const originalOwnerLookup = app.ctx.modules.providers.repository.all.bind(app.ctx.modules.providers.repository)
    let ownerLookupEntered = false
    // 并发窗口：偏好写正在等 fresh 全表读取时发起删除，验证共享完整性锁 + 删除守卫
    app.ctx.modules.providers.repository.all = async (options = {}) => {
      if (options.fresh && !ownerLookupEntered) {
        ownerLookupEntered = true
        ownerLookupReached.resolve()
        await preferenceGate.promise
      }
      return originalOwnerLookup(options)
    }

    try {
      const preferenceWrite = app.ctx.modules.saas.preferences.setNormalizedSyncConfig(
        preferenceOwnerId,
        { zone: 'example.com', fqdn: 'www.example.com' },
        { sync_target: 'dnspod', sync_provider_id: 'dns-target', sync_zone: 'example.com', auto_preferred: false },
        preferenceHostnameId
      )
      await ownerLookupReached.promise
      const deleteOwner = app.ctx.workflows.providerManagement.delete(preferenceOwnerId)
      preferenceGate.resolve()
      await preferenceWrite
      await expect(
        deleteOwner,
        'SaaS preference owner was not protected by shared integrity lock + delete guard'
      ).rejects.toMatchObject({ code: 'provider_in_use' })
    } finally {
      app.ctx.modules.providers.repository.all = originalOwnerLookup
    }

    await expect(
      app.ctx.workflows.providerManagement.delete('dns-target'),
      'SaaS preference sync provider was not protected by delete guard'
    ).rejects.toMatchObject({ code: 'provider_in_use' })
  })
})

describe('关联服务商创建/更新响应的一致性', () => {
  it('EdgeOne 关联 DNSPod 时创建与更新响应都按完整服务商集计算 configured', async () => {
    await app.ctx.workflows.providerManagement.create({
      id: 'edge-dns',
      name: 'EdgeOne linked DNSPod',
      type: 'dnspod',
      secret_id: 'edge-secret-v1',
      secret_key: 'edge-key-v1',
    })
    const createdEdgeOwner = await app.ctx.workflows.providerManagement.create({
      id: 'edge-owner',
      name: 'EdgeOne owner',
      type: 'edgeone',
      dnspod_provider: 'edge-dns',
    })
    expect(createdEdgeOwner.configured, 'linked provider create response used an incomplete provider set').toBe(true)

    const updatedEdgeOwner = await app.ctx.workflows.providerManagement.update('edge-owner', {
      name: 'EdgeOne owner v2',
    })
    const listedEdgeOwner = (await app.ctx.workflows.providerManagement.list()).find((item) => item.id === 'edge-owner')
    expect(updatedEdgeOwner.configured, 'linked provider update response used an incomplete provider set').toBe(true)
    expect(updatedEdgeOwner, 'provider update response disagrees with immediate list response').toEqual(listedEdgeOwner)
  })
})

describe('SaaS 主机名创建：远端前置校验与本地阶段产物', () => {
  it('非法同步引用被拒且不触远端；合法引用先预检；本地偏好失败保留远端 id', async () => {
    let customHostnameCreates = 0
    const saasMutationOrder: string[] = []
    CloudflareClient.prototype.get = async function (requestPath: string) {
      if (requestPath === 'zones') {
        return {
          result: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
          result_info: { page: 1, per_page: 100, total_count: 1, total_pages: 1 },
        }
      }
      if (requestPath === 'zones/zone-1/custom_hostnames') {
        return { result: [], result_info: { page: 1, per_page: 100, total_count: 0, total_pages: 1 } }
      }
      throw new Error(`Unexpected fake Cloudflare GET ${requestPath}`)
    }
    CloudflareClient.prototype.post = async function (requestPath: string) {
      if (requestPath === 'zones/zone-1/custom_hostnames') {
        saasMutationOrder.push('remote-create')
        customHostnameCreates++
        return {
          result: {
            id: `hostname-${customHostnameCreates + 1}`,
            hostname: 'www.example.com',
            status: 'pending',
            ssl: {},
          },
        }
      }
      throw new Error(`Unexpected fake Cloudflare POST ${requestPath}`)
    }

    const saasCreateUrl = '/api/saas/providers/saas-owner/zones/example.com/hostnames'
    const invalidSyncCreate = await app.inject({
      method: 'POST',
      url: saasCreateUrl,
      headers: { cookie: sessionCookie },
      payload: {
        hostname: 'www.example.com',
        sync_target: 'dnspod',
        sync_provider_id: 'cf-owner',
        sync_zone: ' Example.COM ',
        auto_preferred: true,
      },
    })
    expect(invalidSyncCreate.statusCode).toBe(422)
    expect(customHostnameCreates, 'invalid SaaS sync reference reached remote hostname create').toBe(0)

    const originalProviderAllForPreflight = app.ctx.modules.providers.repository.all.bind(
      app.ctx.modules.providers.repository
    )
    let freshProviderReads = 0
    app.ctx.modules.providers.repository.all = async (options = {}) => {
      const providers = await originalProviderAllForPreflight(options)
      if (!options.fresh) return providers
      freshProviderReads++
      return freshProviderReads === 1 ? providers : providers.filter((provider) => provider.id !== 'dns-target')
    }

    let validSyncCreate: Awaited<ReturnType<FastifyInstance['inject']>>
    try {
      validSyncCreate = await app.inject({
        method: 'POST',
        url: saasCreateUrl,
        headers: { cookie: sessionCookie },
        payload: {
          hostname: 'www.example.com',
          sync_target: 'dnspod',
          sync_provider_id: 'dns-target',
          sync_zone: ' Example.COM ',
          auto_preferred: true,
        },
      })
    } finally {
      app.ctx.modules.providers.repository.all = originalProviderAllForPreflight
    }
    expect(validSyncCreate.statusCode, validSyncCreate.body).toBe(201)
    expect(freshProviderReads >= 1, 'SaaS create did not validate sync references before remote create').toBe(true)
    expect(customHostnameCreates).toBe(1)

    const createdPreference = await app.ctx.modules.saas.preferences.get('cf-owner', {
      zone: 'example.com',
      fqdn: 'www.example.com',
    })
    expect(createdPreference?.sync_target).toBe('dnspod')
    expect(createdPreference?.sync_provider_id).toBe('dns-target')
    expect(createdPreference?.sync_zone).toBe('example.com')
    expect(createdPreference?.auto_preferred).toBe(true)

    const originalResolveZoneRef = app.ctx.modules.saas.hostnames.resolveZoneRef.bind(app.ctx.modules.saas.hostnames)
    const originalSetNormalized = app.ctx.modules.saas.preferences.setNormalizedSyncConfig.bind(
      app.ctx.modules.saas.preferences
    )
    app.ctx.modules.saas.hostnames.resolveZoneRef = async (...args) => {
      saasMutationOrder.push('owner')
      return originalResolveZoneRef(...args)
    }
    app.ctx.modules.saas.preferences.setNormalizedSyncConfig = async () => {
      throw new Error('probe preference disk full')
    }

    let stagedCreate: Awaited<ReturnType<typeof app.ctx.workflows.saasDnsSync.createHostname>>
    try {
      stagedCreate = await app.ctx.workflows.saasDnsSync.createHostname(
        'saas-owner',
        'example.com',
        {
          hostname: 'staged.example.com',
          sync_target: 'dnspod',
          sync_provider_id: 'dns-target',
          sync_zone: 'example.com',
        },
        false
      )
    } finally {
      app.ctx.modules.saas.preferences.setNormalizedSyncConfig = originalSetNormalized
      app.ctx.modules.saas.hostnames.resolveZoneRef = originalResolveZoneRef
    }
    const staged = stagedCreate as Record<string, unknown>
    expect(String(staged.id || ''), 'local preference failure lost the successful remote hostname id').toBeTruthy()
    const stagedSideEffects = staged.side_effects as { local?: { preference?: { status?: string } } } | undefined
    expect(
      stagedSideEffects?.local?.preference?.status,
      'local preference failure was not surfaced as a staged side effect'
    ).toBe('failed')
    expect(
      saasMutationOrder.lastIndexOf('owner') < saasMutationOrder.lastIndexOf('remote-create'),
      'SaaS cache owner was resolved after the irreversible remote mutation'
    ).toBe(true)
  })
})

describe('SaaS 主机名删除的本地偏好清理策略', () => {
  it('只有确认远端不存在才清偏好；网络与鉴权失败保留偏好', async () => {
    const hostnameGateway = (
      app.ctx.modules.saas.hostnames as unknown as {
        customHostnames: {
          idByHostname: (...args: unknown[]) => Promise<string>
          delete: (...args: unknown[]) => Promise<Record<string, unknown>>
        }
      }
    ).customHostnames
    const originalIdByHostname = hostnameGateway.idByHostname.bind(hostnameGateway)
    const originalHostnameDelete = hostnameGateway.delete.bind(hostnameGateway)

    for (const [hostnameId, hostname] of [
      ['network-pref', 'network.example.com'],
      ['auth-pref', 'auth.example.com'],
      ['missing-pref', 'missing.example.com'],
      ['upstream-missing-pref', 'upstream-missing.example.com'],
    ] as const) {
      await app.ctx.modules.saas.preferences.setNormalizedSyncConfig(
        'cf-owner',
        { zone: 'example.com', fqdn: hostname },
        { sync_target: 'dnspod', sync_provider_id: 'dns-target', sync_zone: 'example.com', auto_preferred: false },
        hostnameId
      )
    }

    try {
      const resolveFailures = [
        [
          'network.example.com',
          new ApiError('cloudflare_connection_failed', 'network failed', 502),
          'network-pref',
          false,
        ],
        ['auth.example.com', new ApiError('http_error', 'authentication failed', 401), 'auth-pref', false],
        ['missing.example.com', new ApiError('saas_hostname_not_found', 'not found', 404), 'missing-pref', true],
        [
          'upstream-missing.example.com',
          new ApiError('http_error', 'upstream not found', 400, { upstream_status: 404 }),
          'upstream-missing-pref',
          true,
        ],
      ] as const
      for (const [hostname, failure, _preferenceId, shouldClear] of resolveFailures) {
        hostnameGateway.idByHostname = async () => {
          throw failure
        }
        const deletion = app.ctx.modules.saas.hostnames.deleteHostname('saas-owner', 'example.com', hostname)
        if (shouldClear) await deletion
        else await expect(deletion).rejects.toBe(failure)
        const localPreference = await app.ctx.modules.saas.preferences.get('cf-owner', {
          zone: 'example.com',
          fqdn: hostname,
        })
        expect(localPreference === null, `${hostname} local preference clear policy`).toBe(shouldClear)
      }

      await app.ctx.modules.saas.preferences.setNormalizedSyncConfig(
        'cf-owner',
        { zone: 'example.com', fqdn: 'delete-404.example.com' },
        { sync_target: 'dnspod', sync_provider_id: 'dns-target', sync_zone: 'example.com', auto_preferred: false },
        'delete-404-pref'
      )
      hostnameGateway.idByHostname = async () => 'delete-404-pref'
      hostnameGateway.delete = async () => {
        throw new ApiError('saas_hostname_delete_failed', 'upstream hostname missing', 502, { upstream_status: 404 })
      }
      await app.ctx.modules.saas.hostnames.deleteHostname('saas-owner', 'example.com', 'delete-404.example.com')
      expect(
        await app.ctx.modules.saas.preferences.get('cf-owner', { zone: 'example.com', fqdn: 'delete-404.example.com' })
      ).toBeNull()
    } finally {
      hostnameGateway.idByHostname = originalIdByHostname
      hostnameGateway.delete = originalHostnameDelete
    }
  })
})

describe('Cloudflared 隧道令牌副作用与缓存', () => {
  it('令牌获取失败转为副作用且可重取；关联 Cloudflare 更新令隧道缓存失效', async () => {
    let tunnelCreates = 0
    let tokenFetchFails = true
    const tunnelReads = { list: 0, show: 0, config: 0 }
    CloudflareClient.prototype.get = async function (requestPath: string) {
      if (requestPath === 'zones') {
        return {
          result: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
          result_info: { page: 1, per_page: 100, total_count: 1, total_pages: 1 },
        }
      }
      if (requestPath === 'accounts/probe-account/cfd_tunnel') {
        tunnelReads.list++
        return { result: [{ id: 'tunnel-1', name: 'probe-tunnel', status: 'inactive', connections: [] }] }
      }
      if (requestPath === 'accounts/probe-account/cfd_tunnel/tunnel-1') {
        tunnelReads.show++
        return { result: { id: 'tunnel-1', name: 'probe-tunnel', status: 'inactive', connections: [] } }
      }
      if (requestPath === 'accounts/probe-account/cfd_tunnel/tunnel-1/configurations') {
        tunnelReads.config++
        return { result: { version: 1, config: { ingress: [{ service: 'http_status:404' }] } } }
      }
      if (requestPath === 'accounts/probe-account/cfd_tunnel/tunnel-1/token') {
        if (tokenFetchFails) throw new ApiError('probe_token_network_failure', 'probe token network failure', 502)
        return { result: 'retry-token' }
      }
      throw new Error(`Unexpected fake Cloudflare GET ${requestPath}`)
    }
    CloudflareClient.prototype.post = async function (requestPath: string) {
      if (requestPath === 'accounts/probe-account/cfd_tunnel') {
        tunnelCreates++
        return { result: { id: 'tunnel-1', name: 'probe-tunnel', status: 'inactive', connections: [] } }
      }
      throw new Error(`Unexpected fake Cloudflare POST ${requestPath}`)
    }

    const createTunnel = await app.inject({
      method: 'POST',
      url: '/api/cloudflared/providers/tunnel-owner/tunnels',
      headers: { cookie: sessionCookie },
      payload: { name: 'probe-tunnel' },
    })
    expect(createTunnel.statusCode, createTunnel.body).toBe(201)
    expect(tunnelCreates).toBe(1)
    expect(createTunnel.json().data.tunnel.id).toBe('tunnel-1')
    expect(createTunnel.json().data.token).toBeNull()
    expect(createTunnel.json().side_effects.tunnel.token.status).toBe('failed')
    expect(createTunnel.json().side_effects.tunnel.token.message).toMatch(/token/i)

    tokenFetchFails = false
    const retriedToken = await app.inject({
      method: 'GET',
      url: '/api/cloudflared/providers/tunnel-owner/tunnels/tunnel-1/token',
      headers: { cookie: sessionCookie },
    })
    expect(retriedToken.statusCode).toBe(200)
    expect(retriedToken.json().data.token).toBe('retry-token')

    const tunnelCacheUrls = [
      '/api/cloudflared/providers/tunnel-owner/tunnels',
      '/api/cloudflared/providers/tunnel-owner/tunnels/tunnel-1',
      '/api/cloudflared/providers/tunnel-owner/tunnels/tunnel-1/routes',
    ]
    for (const url of tunnelCacheUrls) {
      expect((await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } })).statusCode, url).toBe(200)
      expect((await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } })).statusCode, url).toBe(200)
    }
    expect(tunnelReads).toEqual({ list: 1, show: 1, config: 1 })

    await app.ctx.workflows.providerManagement.update('cf-owner', { name: 'CF owner updated' })
    for (const url of tunnelCacheUrls) {
      expect((await app.inject({ method: 'GET', url, headers: { cookie: sessionCookie } })).statusCode, url).toBe(200)
    }
    expect(tunnelReads, 'linked Cloudflare update left tunnel caches stale').toEqual({ list: 2, show: 2, config: 2 })
  })
})
