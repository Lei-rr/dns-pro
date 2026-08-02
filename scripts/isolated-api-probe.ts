#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { setDataRoot } from '../server/src/platform/storage/json-store.js'
import {
  requestSchemaTypeContractSchema,
  type RequestSchemaTypeContract,
} from '../server/src/shared/http/request-schema.js'
import routeManifest from './api-route-manifest.json' with { type: 'json' }
import {
  DNS_BATCH_CREATE_JOB,
  DNS_BATCH_DELETE_JOB,
  DNS_BATCH_UPDATE_JOB,
} from '../server/src/workflows/dns-batch/dns-batch-job.types.js'
import {
  PREFERRED_APPLY_JOB_TYPE,
  SAAS_BATCH_DELETE_JOB,
  SAAS_BATCH_UPDATE_JOB,
} from '../server/src/workflows/saas-dns-sync/saas-dns-sync-job.types.js'
import {
  EDGEONE_BATCH_DELETE_JOB,
  EDGEONE_BATCH_DISABLE_JOB,
} from '../server/src/workflows/edge-one-dns-sync/edge-one-dns-sync-job.types.js'
import { DnsPodGateway } from '../server/src/modules/dns-pod/dns-pod.client.js'
import { DnsPodRecordService } from '../server/src/modules/dns-pod/dns-pod-record.service.js'
import { DnsPodDnsBatchAdapter } from '../server/src/workflows/dns-batch/dns-pod-dns-batch.adapter.js'
import { EdgeOneGateway } from '../server/src/modules/edge-one/edge-one.client.js'
import { CloudflareGateway } from '../server/src/modules/cloudflare/cloudflare.client.js'
import { ApiError } from '../server/src/shared/http/api-error.js'

const requestSchemaTypeContract: RequestSchemaTypeContract = true
void requestSchemaTypeContract
void requestSchemaTypeContractSchema

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function installWebDistFixture(): Promise<() => Promise<void>> {
  const distDir = path.resolve(process.cwd(), 'web/dist')
  const assetsDir = path.join(distDir, 'assets')
  const indexPath = path.join(distDir, 'index.html')
  let createdDist = false
  let createdAssets = false
  let createdIndex = false

  try {
    await fs.access(distDir)
  } catch {
    await fs.mkdir(distDir, { recursive: true })
    createdDist = true
  }
  try {
    await fs.access(assetsDir)
  } catch {
    await fs.mkdir(assetsDir, { recursive: true })
    createdAssets = true
  }
  try {
    await fs.access(indexPath)
  } catch {
    await fs.writeFile(indexPath, '<!doctype html><html><body>isolated api probe</body></html>\n')
    createdIndex = true
  }

  return async () => {
    if (createdIndex) await fs.rm(indexPath, { force: true })
    if (createdAssets) await fs.rmdir(assetsDir).catch(() => undefined)
    if (createdDist) await fs.rmdir(distDir).catch(() => undefined)
  }
}

const restoreWebDist = await installWebDistFixture()
let dataDir = ''
let app: Awaited<ReturnType<typeof buildApp>> | undefined
try {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-probe-'))
  const configDir = path.join(dataDir)
  await fs.mkdir(configDir, { recursive: true })
  await fs.writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify({ auth: { username: 'probe-admin', password: 'probe-password' } }, null, 2)
  )
  await fs.writeFile(path.join(configDir, 'providers.json'), JSON.stringify({ items: [] }, null, 2))

  const config = {
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    sessionSecret: 'probe-session-secret-that-is-longer-than-thirty-two-characters',
    sessionCookieName: 'dns_pro_probe',
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    httpTimeoutMs: 1000,
  }

  setDataRoot(dataDir)
  app = await buildApp(config)
  await app.ready()
  for (const route of routeManifest) {
    assert.equal(app.hasRoute({ method: route.method, url: route.path }), true, `${route.method} ${route.path}`)
  }

  const anonymous = await app.inject({ method: 'GET', url: '/api/session' })
  assert.equal(anonymous.statusCode, 200)
  assert.equal(anonymous.json().data.authenticated, false)

  const anonymousProviders = await app.inject({ method: 'GET', url: '/api/providers' })
  assert.equal(anonymousProviders.statusCode, 401)
  assert.equal(anonymousProviders.json().code, 'unauthenticated')

  const missingApi = await app.inject({ method: 'GET', url: '/api/definitely-missing' })
  assert.equal(missingApi.statusCode, 404)
  assert.equal(missingApi.json().code, 'not_found')

  for (const request of [
    { method: 'GET', url: '/api' },
    { method: 'GET', url: '/assets' },
    { method: 'POST', url: '/unknown' },
    { method: 'PUT', url: '/some/spa/route' },
    { method: 'GET', url: '/some/spa/route', headers: { accept: 'application/json' } },
  ] as const) {
    const response = await app.inject(request)
    assert.equal(response.statusCode, 404, `${request.method} ${request.url}`)
    assert.match(String(response.headers['content-type']), /^application\/json/)
  }

  const spa = await app.inject({ method: 'GET', url: '/some/spa/route', headers: { accept: 'text/html' } })
  assert.equal(spa.statusCode, 200)
  assert.match(String(spa.headers['content-type']), /^text\/html/)

  const badLogin = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'probe-admin', password: 'wrong' },
  })
  assert.equal(badLogin.statusCode, 401)
  assert.equal(badLogin.json().code, 'invalid_credentials')

  const login = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'probe-admin', password: 'probe-password' },
  })
  assert.equal(login.statusCode, 200)
  assert.equal(login.json().data.authenticated, true)
  const setCookies = login.headers['set-cookie']
  assert.ok(setCookies)
  const cookieLine = Array.isArray(setCookies) ? setCookies.at(-1) : setCookies
  const cookie = String(cookieLine).split(';', 1)[0]
  assert.ok(cookie.includes('='))

  const providers = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie } })
  assert.equal(providers.statusCode, 200)
  assert.deepEqual(providers.json().data, [])

  const duplicateCookie = await app.inject({
    method: 'GET',
    url: '/api/session',
    headers: { cookie: `${config.sessionCookieName}=stale-invalid-token; ${cookie}` },
  })
  assert.equal(duplicateCookie.statusCode, 200)
  assert.equal(duplicateCookie.json().data.authenticated, true)

  const definitions = await app.inject({ method: 'GET', url: '/api/providers/definitions', headers: { cookie } })
  assert.equal(definitions.statusCode, 200)
  assert.ok(Array.isArray(definitions.json().data))
  assert.equal(definitions.json().data.length, 5)

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
  const preferenceOwnerId = 'cf-owner'
  const preferenceHostnameId = 'hostname-1'
  const ownerLookupReached = deferred<void>()
  const preferenceGate = deferred<void>()
  const originalOwnerLookup = app.ctx.modules.providers.repository.all.bind(app.ctx.modules.providers.repository)
  let ownerLookupEntered = false
  app.ctx.modules.providers.repository.all = async (options = {}) => {
    if (options.fresh && !ownerLookupEntered) {
      ownerLookupEntered = true
      ownerLookupReached.resolve()
      await preferenceGate.promise
    }
    return originalOwnerLookup(options)
  }
  const preferenceWrite = app.ctx.modules.saas.preferences.setSyncConfig({
    cloudflareProviderId: preferenceOwnerId,
    hostnameId: preferenceHostnameId,
    syncTarget: 'dnspod',
    syncProviderId: 'dns-target',
    syncZone: 'example.com',
    autoPreferred: false,
    hostname: 'www.example.com',
  })
  await ownerLookupReached.promise
  const deleteOwner = app.ctx.workflows.providerManagement.delete(preferenceOwnerId)
  preferenceGate.resolve()
  await preferenceWrite
  await assert.rejects(
    deleteOwner,
    (error: unknown) =>
      error instanceof Error && 'code' in error && (error as { code?: string }).code === 'provider_in_use',
    'SaaS preference owner was not protected by shared integrity lock + delete guard'
  )
  app.ctx.modules.providers.repository.all = originalOwnerLookup
  await assert.rejects(
    app.ctx.workflows.providerManagement.delete('dns-target'),
    (error: unknown) =>
      error instanceof Error && 'code' in error && (error as { code?: string }).code === 'provider_in_use',
    'SaaS preference sync provider was not protected by delete guard'
  )

  const originalDnsPodCall = DnsPodGateway.prototype.call
  DnsPodGateway.prototype.call = async function (action: string): Promise<unknown> {
    assert.equal(action, 'DescribeRecordList')
    return {
      RecordCountInfo: { TotalCount: 1 },
      RecordList: [
        {
          RecordId: 1,
          Name: 'www',
          Type: 'A',
          Value: '192.0.2.1',
          Line: '境内',
          LineId: '10=0',
          Status: 'ENABLE',
          TTL: 60,
        },
      ],
      RequestId: 'probe-request',
    }
  }
  try {
    const adapter = new DnsPodDnsBatchAdapter(new DnsPodRecordService(app.ctx.modules.providers.repository))
    const exact = await adapter.findCreate('dns-target', 'example.com', {
      subdomain: 'www',
      record_type: 'A',
      value: '192.0.2.1',
      record_line: '默认',
      record_line_id: '10=0',
      ttl: 60,
    })
    assert.notEqual(exact, null, 'DNSPod adapter production chain did not prefer stable line_id')
  } finally {
    DnsPodGateway.prototype.call = originalDnsPodCall
  }

  await app.ctx.workflows.providerManagement.create({
    id: 'edge-dns',
    name: 'EdgeOne linked DNSPod',
    type: 'dnspod',
    secret_id: 'edge-secret-v1',
    secret_key: 'edge-key-v1',
  })
  await app.ctx.workflows.providerManagement.create({
    id: 'edge-owner',
    name: 'EdgeOne owner',
    type: 'edgeone',
    dnspod_provider: 'edge-dns',
  })

  const originalEdgeOneCall = EdgeOneGateway.prototype.call
  const originalEdgeDnsPodCall = DnsPodGateway.prototype.call
  let edgeZoneLoads = 0
  let edgeDomainLoads = 0
  let primaryDeleteCalls = 0
  let dnsRecordLists = 0
  EdgeOneGateway.prototype.call = async function (action: string, payload: Record<string, unknown>): Promise<unknown> {
    if (action === 'DescribeZones') {
      edgeZoneLoads++
      return { Zones: [{ ZoneId: 'zone-1', ZoneName: 'example.com' }], TotalCount: 1, RequestId: 'zones' }
    }
    if (action === 'DescribeAccelerationDomains') {
      edgeDomainLoads++
      return {
        AccelerationDomains: [
          { ZoneId: payload.ZoneId, DomainName: 'www.example.com', Cname: 'www.example.com.eo.dnse5.com' },
        ],
        TotalCount: 1,
        RequestId: 'domains',
      }
    }
    if (action === 'DeleteAccelerationDomains') {
      primaryDeleteCalls++
      if ((payload.DomainNames as string[])[0] === 'gone.example.com' || primaryDeleteCalls > 1) {
        throw new ApiError('edgeone_request_failed', 'EdgeOne API error: ResourceNotFound.AccelerationDomain', 502, {
          code: 'ResourceNotFound.AccelerationDomain',
        })
      }
      return { RequestId: 'deleted' }
    }
    assert.fail(`unexpected EdgeOne action: ${action}`)
  }
  DnsPodGateway.prototype.call = async function (action: string): Promise<unknown> {
    if (action === 'DescribeDomainList') {
      return {
        DomainList: [{ DomainId: 1, Name: 'example.com' }],
        DomainCountInfo: { DomainTotal: 1 },
        RequestId: 'dns-zones',
      }
    }
    if (action === 'DescribeRecordList') {
      dnsRecordLists++
      if (dnsRecordLists === 1) throw new ApiError('dnspod_request_failed', 'temporary DNS cleanup failure', 502)
      return {
        RecordList: [
          {
            RecordId: dnsRecordLists,
            Name: dnsRecordLists === 2 ? 'www' : 'gone',
            Type: 'CNAME',
            Value: 'target.eo.dnse5.com',
            Line: '默认',
          },
        ],
        RecordCountInfo: { TotalCount: 1 },
        RequestId: 'dns-records',
      }
    }
    if (action === 'DeleteRecord') return { RecordId: 1, RequestId: 'dns-deleted' }
    assert.fail(`unexpected DNSPod action: ${action}`)
  }
  try {
    await app.ctx.modules.edgeOne.zones.zones('edge-owner')
    await app.ctx.modules.edgeOne.zones.zones('edge-owner')
    await app.ctx.modules.edgeOne.domains.accelerationDomains('edge-owner', 'zone-1')
    await app.ctx.modules.edgeOne.domains.accelerationDomains('edge-owner', 'zone-1')
    assert.equal(edgeZoneLoads, 1, 'EdgeOne zone cache did not hit before linked-provider update')
    assert.equal(edgeDomainLoads, 1, 'EdgeOne domain cache did not hit before linked-provider update')
    await app.ctx.workflows.providerManagement.update('edge-dns', { secret_key: 'edge-key-v2' })
    await app.ctx.modules.edgeOne.zones.zones('edge-owner')
    await app.ctx.modules.edgeOne.domains.accelerationDomains('edge-owner', 'zone-1')
    assert.equal(edgeZoneLoads, 2, 'linked DNSPod provider update did not evict EdgeOne zone cache')
    assert.equal(edgeDomainLoads, 2, 'linked DNSPod provider update did not evict EdgeOne domain cache')

    const failedDelete = await app.ctx.workflows.edgeOneBatch.createDelete({
      providerId: 'edge-owner',
      zoneId: 'zone-1',
      domains: ['www.example.com'],
      autoCleanup: true,
    })
    await app.ctx.platform.jobs.drain()
    const failedDeleteState = await app.ctx.workflows.edgeOneBatch.find(failedDelete.id)
    assert.equal(failedDeleteState?.status, 'failed')
    assert.equal(failedDeleteState?.items[0]?.primary_deleted, true)
    assert.equal(failedDeleteState?.items[0]?.dns_cleanup_status, 'failed')
    assert.equal(primaryDeleteCalls, 1)

    await app.ctx.workflows.edgeOneBatch.retryFailed(failedDelete.id)
    await app.ctx.platform.jobs.drain()
    const retriedDeleteState = await app.ctx.workflows.edgeOneBatch.find(failedDelete.id)
    assert.equal(retriedDeleteState?.status, 'completed')
    assert.equal(retriedDeleteState?.items[0]?.status, 'success')
    assert.equal(retriedDeleteState?.items[0]?.primary_deleted, true)
    assert.equal(retriedDeleteState?.items[0]?.dns_cleanup_status, 'completed')
    assert.equal(primaryDeleteCalls, 1, 'retry replayed an already-completed EdgeOne delete stage')

    const legacyDelete = await app.ctx.platform.jobs.createTerminalExclusive(
      EDGEONE_BATCH_DELETE_JOB,
      { provider_id: 'edge-owner', zone_id: 'zone-404', auto_cleanup: true },
      [{ domain: 'gone.example.com', status: 'failed' }],
      undefined,
      { status: 'failed', success: 0, failed: 1, skipped: 0, message: 'legacy cleanup failure' }
    )
    await app.ctx.workflows.edgeOneBatch.retryFailed(legacyDelete.id)
    await app.ctx.platform.jobs.drain()
    const missingDeleteState = await app.ctx.workflows.edgeOneBatch.find(legacyDelete.id)
    assert.equal(missingDeleteState?.status, 'completed')
    assert.equal(missingDeleteState?.items[0]?.status, 'success')
    assert.equal(missingDeleteState?.items[0]?.primary_deleted, true)
    assert.equal(missingDeleteState?.items[0]?.dns_cleanup_status, 'completed')
  } finally {
    EdgeOneGateway.prototype.call = originalEdgeOneCall
    DnsPodGateway.prototype.call = originalEdgeDnsPodCall
  }

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

  const originalCloudflareGet = CloudflareGateway.prototype.get
  const originalCloudflarePost = CloudflareGateway.prototype.post
  let customHostnameCreates = 0
  let tunnelCreates = 0
  let tokenFetchFails = true
  const tunnelReads = { list: 0, show: 0, config: 0 }
  CloudflareGateway.prototype.get = async function (requestPath: string): Promise<Record<string, unknown>> {
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
  CloudflareGateway.prototype.post = async function (requestPath: string): Promise<Record<string, unknown>> {
    if (requestPath === 'zones/zone-1/custom_hostnames') {
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
    if (requestPath === 'accounts/probe-account/cfd_tunnel') {
      tunnelCreates++
      return { result: { id: 'tunnel-1', name: 'probe-tunnel', status: 'inactive', connections: [] } }
    }
    throw new Error(`Unexpected fake Cloudflare POST ${requestPath}`)
  }

  try {
    const saasCreateUrl = '/api/saas/providers/saas-owner/zones/example.com/hostnames'
    const invalidSyncCreate = await app.inject({
      method: 'POST',
      url: saasCreateUrl,
      headers: { cookie },
      payload: {
        hostname: 'www.example.com',
        sync_target: 'dnspod',
        sync_provider_id: 'cf-owner',
        sync_zone: ' Example.COM ',
        auto_preferred: true,
      },
    })
    assert.equal(invalidSyncCreate.statusCode, 422)
    assert.equal(customHostnameCreates, 0, 'invalid SaaS sync reference reached remote hostname create')

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
    const validSyncCreate = await app.inject({
      method: 'POST',
      url: saasCreateUrl,
      headers: { cookie },
      payload: {
        hostname: 'www.example.com',
        sync_target: 'dnspod',
        sync_provider_id: 'dns-target',
        sync_zone: ' Example.COM ',
        auto_preferred: true,
      },
    })
    app.ctx.modules.providers.repository.all = originalProviderAllForPreflight
    assert.equal(validSyncCreate.statusCode, 201, validSyncCreate.body)
    assert.ok(freshProviderReads >= 1, 'SaaS create did not validate sync references before remote create')
    assert.equal(customHostnameCreates, 1)
    const createdPreference = await app.ctx.modules.saas.preferences.get('cf-owner', 'hostname-2')
    assert.equal(createdPreference?.sync_target, 'dnspod')
    assert.equal(createdPreference?.sync_provider_id, 'dns-target')
    assert.equal(createdPreference?.sync_zone, 'example.com')
    assert.equal(createdPreference?.auto_preferred, true)

    const hostnameGateway = (
      app.ctx.modules.saas.hostnames as unknown as {
        cloudflareHostnames: { idByHostname: (...args: unknown[]) => Promise<string> }
      }
    ).cloudflareHostnames
    const originalIdByHostname = hostnameGateway.idByHostname.bind(hostnameGateway)
    for (const [hostnameId, hostname] of [
      ['network-pref', 'network.example.com'],
      ['auth-pref', 'auth.example.com'],
      ['missing-pref', 'missing.example.com'],
      ['upstream-missing-pref', 'upstream-missing.example.com'],
    ]) {
      await app.ctx.modules.saas.preferences.setSyncConfig({
        cloudflareProviderId: 'cf-owner',
        hostnameId,
        syncTarget: 'dnspod',
        syncProviderId: 'dns-target',
        syncZone: 'example.com',
        autoPreferred: false,
        hostname,
      })
    }
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
        new ApiError('http_error', 'upstream not found', 404),
        'upstream-missing-pref',
        true,
      ],
    ] as const
    for (const [hostname, failure, preferenceId, shouldClear] of resolveFailures) {
      hostnameGateway.idByHostname = async () => {
        throw failure
      }
      const deletion = app.ctx.modules.saas.hostnames.deleteHostname('saas-owner', 'example.com', hostname)
      if (shouldClear) await deletion
      else await assert.rejects(deletion, (error: unknown) => error === failure)
      const localPreference = await app.ctx.modules.saas.preferences.get('cf-owner', preferenceId)
      assert.equal(localPreference === null, shouldClear, `${hostname} local preference clear policy`)
    }
    hostnameGateway.idByHostname = originalIdByHostname

    const createTunnel = await app.inject({
      method: 'POST',
      url: '/api/cloudflared/providers/tunnel-owner/tunnels',
      headers: { cookie },
      payload: { name: 'probe-tunnel' },
    })
    assert.equal(createTunnel.statusCode, 201, createTunnel.body)
    assert.equal(tunnelCreates, 1)
    assert.equal(createTunnel.json().data.tunnel.id, 'tunnel-1')
    assert.equal(createTunnel.json().data.token, null)
    assert.equal(createTunnel.json().side_effects.tunnel.token.status, 'failed')
    assert.match(createTunnel.json().side_effects.tunnel.token.message, /token/i)

    tokenFetchFails = false
    const retriedToken = await app.inject({
      method: 'GET',
      url: '/api/cloudflared/providers/tunnel-owner/tunnels/tunnel-1/token',
      headers: { cookie },
    })
    assert.equal(retriedToken.statusCode, 200)
    assert.equal(retriedToken.json().data.token, 'retry-token')

    const tunnelCacheUrls = [
      '/api/cloudflared/providers/tunnel-owner/tunnels',
      '/api/cloudflared/providers/tunnel-owner/tunnels/tunnel-1',
      '/api/cloudflared/providers/tunnel-owner/tunnels/tunnel-1/routes',
    ]
    for (const url of tunnelCacheUrls) {
      assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 200, url)
      assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 200, url)
    }
    assert.deepEqual(tunnelReads, { list: 1, show: 1, config: 1 })
    await app.ctx.workflows.providerManagement.update('cf-owner', { name: 'CF owner updated' })
    for (const url of tunnelCacheUrls) {
      assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 200, url)
    }
    assert.deepEqual(tunnelReads, { list: 2, show: 2, config: 2 }, 'linked Cloudflare update left tunnel caches stale')
  } finally {
    CloudflareGateway.prototype.get = originalCloudflareGet
    CloudflareGateway.prototype.post = originalCloudflarePost
  }

  const assertNoBatchInternals = (value: unknown, location = 'response'): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoBatchInternals(item, `${location}[${index}]`))
      return
    }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    for (const field of ['operation_id', 'attempt', 'item_key']) {
      assert.equal(field in row, false, `${location} leaked ${field}`)
    }
    for (const [key, child] of Object.entries(row)) assertNoBatchInternals(child, `${location}.${key}`)
  }

  const internalItems = [
    {
      hostname: 'www.example.com',
      status: 'failed',
      operation_id: 'internal-operation',
      attempt: 2,
      item_key: 'internal-item',
    },
  ]
  const presenterJobs = [
    {
      type: DNS_BATCH_CREATE_JOB,
      payload: { provider_type: 'cloudflare', provider_id: 'missing', zone: 'example.com' },
      url: '/api/cloudflare/providers/missing/records/batch',
    },
    {
      type: DNS_BATCH_DELETE_JOB,
      payload: { provider_type: 'cloudflare', provider_id: 'missing', zone: 'example.com' },
      url: '/api/cloudflare/providers/missing/records/batch',
    },
    {
      type: DNS_BATCH_UPDATE_JOB,
      payload: { provider_type: 'dnspod', provider_id: 'missing', zone: 'example.com', patch: {} },
      url: '/api/dnspod/providers/missing/records/batch',
    },
    {
      type: SAAS_BATCH_DELETE_JOB,
      payload: { provider_id: 'missing', zone_name: 'example.com' },
      url: '/api/saas/batch',
    },
    {
      type: SAAS_BATCH_UPDATE_JOB,
      payload: { provider_id: 'missing', zone_name: 'example.com', patch: {} },
      url: '/api/saas/batch',
    },
    {
      type: PREFERRED_APPLY_JOB_TYPE,
      payload: { provider_id: 'missing', zone_name: 'example.com', preferred_domain: 'target.example.com' },
      url: '/api/saas/preferred-apply',
    },
    {
      type: EDGEONE_BATCH_DISABLE_JOB,
      payload: { provider_id: 'missing', zone_id: 'zone-1' },
      url: '/api/edgeone/providers/missing/batch',
    },
    {
      type: EDGEONE_BATCH_DELETE_JOB,
      payload: { provider_id: 'missing', zone_id: 'zone-1' },
      url: '/api/edgeone/providers/missing/batch',
    },
  ]
  for (const presenter of presenterJobs) {
    const job = await app.ctx.platform.jobs.createTerminalExclusive(
      presenter.type,
      presenter.payload,
      internalItems,
      undefined,
      { status: 'failed', success: 0, failed: 1, skipped: 0, message: 'probe' }
    )
    await fs.writeFile(path.join(dataDir, 'jobs/jobs.json'), `${JSON.stringify({ items: [job] }, null, 2)}\n`)
    setDataRoot(dataDir)
    const response = await app.inject({ method: 'GET', url: `${presenter.url}/${job.id}`, headers: { cookie } })
    assert.equal(response.statusCode, 200, `${presenter.type} presenter status`)
    assertNoBatchInternals(response.json().data, presenter.type)
  }

  const validation = await app.inject({ method: 'POST', url: '/api/providers', headers: { cookie }, payload: {} })
  assert.equal(validation.statusCode, 400)

  const batchBase = '/api/cloudflare/providers/missing/zones/example.com/records'
  const validBatches = [
    {
      url: `${batchBase}/batch-create`,
      payload: { records: [{ name: 'www', type: 'A', value: '192.0.2.1' }] },
    },
    {
      url: `${batchBase}/batch-delete`,
      payload: { records: [{ id: 'record-1', name: 'www', type: 'A' }] },
    },
    {
      url: `${batchBase}/batch-update`,
      payload: {
        records: [{ id: 'record-1', name: 'www', type: 'A', value: '192.0.2.1' }],
        patch: { value: '192.0.2.2' },
      },
    },
  ]
  for (const batch of validBatches) {
    const response = await app.inject({ method: 'POST', url: batch.url, headers: { cookie }, payload: batch.payload })
    assert.equal(response.statusCode, 201, batch.url)
    await app.ctx.platform.jobs.drain()
  }

  const legacyBatchDelete = await app.inject({
    method: 'POST',
    url: `${batchBase}/batch-delete`,
    headers: { cookie },
    payload: { record_ids: ['record-1'] },
  })
  assert.equal(legacyBatchDelete.statusCode, 400)

  const legacyBatchCreate = await app.inject({
    method: 'POST',
    url: `${batchBase}/batch-create`,
    headers: { cookie },
    payload: { records: [{ subdomain: 'www', record_type: 'A', content: '192.0.2.1' }] },
  })
  assert.equal(legacyBatchCreate.statusCode, 400)

  const legacyDnsPodZone = await app.inject({
    method: 'POST',
    url: '/api/dnspod/providers/missing/zones',
    headers: { cookie },
    payload: { name: 'example.com' },
  })
  assert.equal(legacyDnsPodZone.statusCode, 400)

  const legacyCloudflareZone = await app.inject({
    method: 'POST',
    url: '/api/cloudflare/providers/missing/zones',
    headers: { cookie },
    payload: { domain: 'example.com' },
  })
  assert.equal(legacyCloudflareZone.statusCode, 400)

  const cloudflareZoneType = await app.inject({
    method: 'POST',
    url: '/api/cloudflare/providers/missing/zones',
    headers: { cookie },
    payload: { name: 'example.com', type: 'partial' },
  })
  assert.equal(cloudflareZoneType.statusCode, 400)

  const conflictingBatchZone = await app.inject({
    method: 'POST',
    url: `${batchBase}/batch-create`,
    headers: { cookie },
    payload: {
      zone_name: 'other.example.com',
      records: [{ name: 'www', type: 'A', value: '192.0.2.1' }],
    },
  })
  assert.equal(conflictingBatchZone.statusCode, 400)

  const legacySaasBatch = await app.inject({
    method: 'POST',
    url: '/api/saas/providers/missing/zones/example.com/batch/delete',
    headers: { cookie },
    payload: { items: ['www.example.com'] },
  })
  assert.equal(legacySaasBatch.statusCode, 400)

  const legacyEdgeOneBatch = await app.inject({
    method: 'POST',
    url: '/api/edgeone/providers/missing/zones/zone-1/batch/disable',
    headers: { cookie },
    payload: { items: ['www.example.com'] },
  })
  assert.equal(legacyEdgeOneBatch.statusCode, 400)

  const health = await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })
  assert.equal(health.statusCode, 200)
  assert.deepEqual(Object.keys(health.json().data.cache), ['size'])

  const logout = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } })
  assert.equal(logout.statusCode, 204)

  console.log(`isolated-probe=ok data=${dataDir}`)
} finally {
  try {
    if (app) await app.close()
  } finally {
    try {
      if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
    } finally {
      await restoreWebDist()
    }
  }
}
