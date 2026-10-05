#!/usr/bin/env node
import assert from 'node:assert/strict'
import { DnsWriter } from '../server/workflows/derived-records/dns-writer.js'
import { dnsPodRecordPort } from '../server/modules/dnspod/dns/dns-pod-record.adapter.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/app/lifecycle.js'
import { requestSchemaTypeContractSchema, type RequestSchemaTypeContract } from '../server/core/http/request-schema.js'
import routeManifest from './api-route-manifest.json' with { type: 'json' }
import { DNS_BATCH_CREATE_JOB, DNS_BATCH_DELETE_JOB, DNS_BATCH_UPDATE_JOB } from '../server/core/jobs/job-registry.js'
import { PREFERRED_APPLY_JOB, SAAS_BATCH_DELETE_JOB, SAAS_BATCH_UPDATE_JOB } from '../server/core/jobs/job-registry.js'
import { EDGEONE_BATCH_DELETE_JOB, EDGEONE_BATCH_DISABLE_JOB } from '../server/core/jobs/job-registry.js'
import { DnsPodClient } from '../server/modules/dnspod/dns-pod.client.js'
import { DnsPodRecordService } from '../server/modules/dnspod/dns-pod-record.service.js'
import { dnsPodRecordPort } from '../server/modules/dnspod/dns/dns-pod-record.adapter.js'
import { dnsRecordMatches } from '../server/core/contracts/dns-record.port.js'
import { EdgeOneClient } from '../server/modules/edge-one/edge-one.client.js'
import { CloudflareClient } from '../server/modules/cloudflare/cloudflare.client.js'
import { ApiError } from '../server/core/http/api-error.js'

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

  // Verify rate limiting: 5 failed attempts from a specific IP lock out that IP for 15 minutes
  for (let i = 0; i < 4; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: 'probe-admin', password: 'wrong-password' },
      remoteAddress: '192.168.1.100',
    })
    assert.equal(res.statusCode, 401)
    assert.equal(res.json().code, 'invalid_credentials')
  }
  const fifthFailed = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'probe-admin', password: 'wrong-password' },
    remoteAddress: '192.168.1.100',
  })
  assert.equal(fifthFailed.statusCode, 401)

  // 6th attempt: should be blocked with 429 and retry_after in details
  const rateLimited = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'probe-admin', password: 'probe-password' },
    remoteAddress: '192.168.1.100',
  })
  assert.equal(rateLimited.statusCode, 429)
  assert.equal(rateLimited.json().code, 'auth_rate_limited')
  assert.match(String(rateLimited.json().message), /锁定/)
  assert.ok(Number((rateLimited.json().details as { retry_after: number })?.retry_after) > 0)

  // Other IP is not affected
  const otherIpLogin = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'probe-admin', password: 'probe-password' },
    remoteAddress: '192.168.1.200',
  })
  assert.equal(otherIpLogin.statusCode, 200)
  assert.equal(otherIpLogin.json().data.authenticated, true)

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
    identity: { zone: 'example.com', fqdn: 'www.example.com' },
    hostnameId: preferenceHostnameId,
    syncTarget: 'dnspod',
    syncProviderId: 'dns-target',
    syncZone: 'example.com',
    autoPreferred: false,
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

  const originalDnsPodCall = DnsPodClient.prototype.call
  const deletedRecordIds: number[] = []
  DnsPodClient.prototype.call = async function (
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<unknown> {
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
    const port = dnsPodRecordPort(new DnsPodRecordService(app.ctx.modules.providers.repository))
    const expected = {
      type: 'A',
      name: 'www',
      value: '192.0.2.1',
      line: '默认',
      lineId: '10=0',
      ttl: 60,
    }
    const candidates = await port.find('dns-target', 'example.com', expected)
    const exact = candidates.find((ref) => dnsRecordMatches(ref.value, expected)) ?? null
    assert.notEqual(exact, null, 'DNSPod adapter production chain did not prefer stable line_id')
  } finally {
    DnsPodClient.prototype.call = originalDnsPodCall
  }

  // 预清理冲突记录：默认 NS（以及任何 NS/SOA）绝不能删除，其余冲突类型才清理
  const precleanDeleted: number[] = []
  DnsPodClient.prototype.call = async function (action: string, payload: Record<string, unknown> = {}) {
    if (action === 'DeleteRecord') {
      precleanDeleted.push(Number(payload.RecordId))
      return { RequestId: 'deleted' }
    }
    assert.equal(action, 'DescribeRecordList')
    return {
      RecordCountInfo: { TotalCount: 3 },
      RecordList: [
        { RecordId: 10, Name: '@', Type: 'NS', Value: 'ns1.dnspod.net', Line: '默认', DefaultNS: true },
        { RecordId: 12, Name: '@', Type: 'TXT', Value: 'keep-me', Line: '默认' },
        { RecordId: 11, Name: '@', Type: 'A', Value: '192.0.2.9', Line: '默认' },
      ],
      RequestId: 'preclean',
    }
  }
  try {
    const writer = new DnsWriter(
      { dnspod: dnsPodRecordPort(app.ctx.modules.dnsPod.records) },
      {
        claimsFor: async () => [{ fqdn: 'example.com', owner: 'saas', refId: 'probe-preclean' }],
      }
    )
    const cleaned = await writer.preclean(
      'dnspod',
      'dns-target',
      'example.com',
      {
        fqdn: 'example.com',
        type: 'CNAME',
      },
      'saas'
    )
    assert.deepEqual(
      cleaned.map((item) => item.record_id),
      ['11'],
      `预清理只应删除冲突的 A 记录：${JSON.stringify(cleaned)}`
    )
    assert.deepEqual(precleanDeleted, [11], '预清理不得删除默认 NS 记录')
  } finally {
    DnsPodClient.prototype.call = originalDnsPodCall
  }

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
  assert.equal(createdEdgeOwner.configured, true, 'linked provider create response used an incomplete provider set')
  const updatedEdgeOwner = await app.ctx.workflows.providerManagement.update('edge-owner', { name: 'EdgeOne owner v2' })
  const listedEdgeOwner = (await app.ctx.workflows.providerManagement.list()).find((item) => item.id === 'edge-owner')
  assert.equal(updatedEdgeOwner.configured, true, 'linked provider update response used an incomplete provider set')
  assert.deepEqual(updatedEdgeOwner, listedEdgeOwner, 'provider update response disagrees with immediate list response')

  const originalEdgeOneCall = EdgeOneClient.prototype.call
  const originalEdgeDnsPodCall = DnsPodClient.prototype.call
  let edgeZoneLoads = 0
  let edgeDomainLoads = 0
  let edgeCreateCalls = 0
  let primaryDeleteCalls = 0
  let failDeleteCnameLookup = false
  let dnsRecordLists = 0
  EdgeOneClient.prototype.call = async function (action: string, payload: Record<string, unknown>): Promise<unknown> {
    if (action === 'CreateAccelerationDomain') {
      edgeCreateCalls++
      return { RequestId: 'created-but-cname-pending' }
    }
    if (action === 'DescribeZones') {
      edgeZoneLoads++
      return { Zones: [{ ZoneId: 'zone-1', ZoneName: 'example.com' }], TotalCount: 1, RequestId: 'zones' }
    }
    if (action === 'DescribeAccelerationDomains') {
      edgeDomainLoads++
      if (failDeleteCnameLookup) throw new ApiError('edgeone_request_failed', 'temporary CNAME lookup failure', 502)
      return {
        AccelerationDomains: [
          { ZoneId: payload.ZoneId, DomainName: 'www.example.com', Cname: 'www.example.com.eo.dnse5.com' },
        ],
        TotalCount: 1,
        RequestId: 'modules',
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
  const edgeDeletedRecordIds: number[] = []
  DnsPodClient.prototype.call = async function (
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<unknown> {
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
      // 同主机名下混入一条人工记录：清理不得删除它
      const manual =
        dnsRecordLists === 2
          ? [{ RecordId: 900, Name: 'www', Type: 'CNAME', Value: 'manual.example.net', Line: '默认', Remark: '' }]
          : []
      return {
        RecordList: [
          ...manual,
          {
            RecordId: dnsRecordLists,
            Name: dnsRecordLists === 2 ? 'www' : 'gone',
            Type: 'CNAME',
            Value: 'target.eo.dnse5.com',
            Line: '默认',
            // 本流程写入的记录带固定备注：清理只按备注匹配，避免误删人工记录
            Remark: `EdgeOne 加速丨${dnsRecordLists === 2 ? 'www.example.com' : 'gone.example.com'}`,
          },
        ],
        RecordCountInfo: { TotalCount: 1 },
        RequestId: 'dns-records',
      }
    }
    if (action === 'DeleteRecord') {
      edgeDeletedRecordIds.push(Number(payload.RecordId))
      return { RequestId: 'dns-deleted' }
    }
    assert.fail(`unexpected DNSPod action: ${action}`)
  }
  try {
    const createdWithPendingCname = await app.ctx.workflows.edgeOneDnsSync.createAccelerationDomain(
      'edge-owner',
      'zone-1',
      { domain_name: 'pending.example.com', origin: '192.0.2.10' },
      true
    )
    assert.equal(edgeCreateCalls, 1)
    assert.equal(createdWithPendingCname.name, 'pending.example.com')
    assert.equal(
      (createdWithPendingCname.side_effects as any)?.dns?.sync?.status,
      'failed',
      'post-create CNAME lookup failure hid a successful primary create'
    )

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

    const deletesBeforeLookupFailure = primaryDeleteCalls
    failDeleteCnameLookup = true
    await app.ctx.workflows.providerManagement.update('edge-dns', { secret_key: 'edge-key-v3' })
    await assert.rejects(
      app.ctx.workflows.edgeOneDnsSync.deleteAccelerationDomain('edge-owner', 'zone-1', 'www.example.com', true),
      (error: unknown) => error instanceof ApiError && error.code === 'edgeone_request_failed'
    )
    failDeleteCnameLookup = false
    assert.equal(
      primaryDeleteCalls,
      deletesBeforeLookupFailure,
      'EdgeOne primary delete ran after CNAME cleanup lookup failed'
    )

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
    assert.equal(edgeDeletedRecordIds.includes(900), false, '清理误删了人工添加的同名记录')
  } finally {
    EdgeOneClient.prototype.call = originalEdgeOneCall
    DnsPodClient.prototype.call = originalEdgeDnsPodCall
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

  const originalCloudflareGet = CloudflareClient.prototype.get
  const originalCloudflarePost = CloudflareClient.prototype.post
  let customHostnameCreates = 0
  let customHostnameLists = 0
  const saasMutationOrder: string[] = []
  let tunnelCreates = 0
  let tokenFetchFails = true
  const tunnelReads = { list: 0, show: 0, config: 0 }
  CloudflareClient.prototype.get = async function (requestPath: string): Promise<Record<string, unknown>> {
    if (requestPath === 'zones') {
      return {
        result: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
        result_info: { page: 1, per_page: 100, total_count: 1, total_pages: 1 },
      }
    }
    if (requestPath === 'zones/zone-1/custom_hostnames') {
      customHostnameLists++
      return { result: [], result_info: { page: 1, per_page: 100, total_count: 0, total_pages: 1 } }
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
  CloudflareClient.prototype.post = async function (requestPath: string): Promise<Record<string, unknown>> {
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
    const createdPreference = await app.ctx.modules.saas.preferences.get('cf-owner', {
      zone: 'example.com',
      fqdn: 'www.example.com',
    })
    assert.equal(createdPreference?.sync_target, 'dnspod')
    assert.equal(createdPreference?.sync_provider_id, 'dns-target')
    assert.equal(createdPreference?.sync_zone, 'example.com')
    assert.equal(createdPreference?.auto_preferred, true)

    const originalResolveZoneRef = app.ctx.modules.saas.hostnames.resolveZoneRef.bind(app.ctx.modules.saas.hostnames)
    app.ctx.modules.saas.hostnames.resolveZoneRef = async (...args) => {
      saasMutationOrder.push('owner')
      return originalResolveZoneRef(...args)
    }
    const originalSetNormalized = app.ctx.modules.saas.preferences.setNormalizedSyncConfig.bind(
      app.ctx.modules.saas.preferences
    )
    app.ctx.modules.saas.preferences.setNormalizedSyncConfig = async () => {
      throw new Error('probe preference disk full')
    }
    const stagedCreate = await app.ctx.workflows.saasDnsSync.createHostname(
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
    app.ctx.modules.saas.preferences.setNormalizedSyncConfig = originalSetNormalized
    app.ctx.modules.saas.hostnames.resolveZoneRef = originalResolveZoneRef
    assert.ok(String(stagedCreate.id || ''), 'local preference failure lost the successful remote hostname id')
    assert.equal(
      (stagedCreate.side_effects as any)?.local?.preference?.status,
      'failed',
      'local preference failure was not surfaced as a staged side effect'
    )
    assert.ok(
      saasMutationOrder.lastIndexOf('owner') < saasMutationOrder.lastIndexOf('remote-create'),
      'SaaS cache owner was resolved after the irreversible remote mutation'
    )

    const stagedGateway = (
      app.ctx.modules.saas.hostnames as unknown as {
        customHostnames: {
          idByHostname: (...args: unknown[]) => Promise<string>
          show: (...args: unknown[]) => Promise<Record<string, unknown>>
          update: (...args: unknown[]) => Promise<Record<string, unknown>>
        }
      }
    ).customHostnames
    const stagedOriginalId = stagedGateway.idByHostname.bind(stagedGateway)
    const stagedOriginalShow = stagedGateway.show.bind(stagedGateway)
    const stagedOriginalUpdate = stagedGateway.update.bind(stagedGateway)
    const originalMarkOwnership = app.ctx.modules.saas.preferences.markOwnershipTxtCleaned.bind(
      app.ctx.modules.saas.preferences
    )
    let stagedRemoteUpdates = 0
    let failLocalStage = true
    stagedGateway.idByHostname = async () => 'batch-host'
    stagedGateway.show = async () => ({
      id: 'batch-host',
      hostname: 'batch.example.com',
      custom_origin_server: 'old.example.com',
      status: 'active',
      ssl: {},
    })
    stagedGateway.update = async () => {
      stagedRemoteUpdates++
      return {
        id: 'batch-host',
        hostname: 'batch.example.com',
        custom_origin_server: 'new.example.com',
        status: 'active',
        ssl: {},
      }
    }
    app.ctx.modules.saas.preferences.markOwnershipTxtCleaned = async (...args) => {
      if (failLocalStage) {
        failLocalStage = false
        throw new Error('probe ownership preference disk full')
      }
      return originalMarkOwnership(...args)
    }
    const stagedSync = (
      app.ctx.workflows.saasDnsSync as unknown as {
        sync: {
          collect: (...args: unknown[]) => Promise<{
            hostname_fqdn: string
            records: Record<string, unknown>[]
          }>
          resync: (...args: unknown[]) => Promise<Record<string, unknown>>
        }
      }
    ).sync
    const originalCollect = stagedSync.collect.bind(stagedSync)
    const originalResync = stagedSync.resync.bind(stagedSync)
    const stagedBeforeRecords = [
      {
        type: 'CNAME',
        name: 'batch.example.com',
        value: 'old-preferred.example.net',
        purpose: 'preferred_cname',
        provider_id: 'dns-target',
        dnspod_zone: 'example.com',
        line: '境内',
      },
    ]
    let stagedCollectCalls = 0
    let stagedResyncBefore: unknown = null
    stagedSync.collect = async () => {
      stagedCollectCalls++
      return { hostname_fqdn: 'batch.example.com', records: stagedBeforeRecords }
    }
    stagedSync.resync = async (_provider, _zone, _hostname, beforeRecords) => {
      stagedResyncBefore = beforeRecords
      return { status: 'completed', records: [] }
    }
    const stagedJob = await app.ctx.workflows.saasBatch.createUpdate({
      providerId: 'saas-owner',
      zoneName: 'example.com',
      hostnames: ['batch.example.com'],
      patch: { custom_origin_server: 'new.example.com', auto_preferred: false },
      autoSync: true,
    })
    await app.ctx.platform.jobs.drain()
    const stagedFailed = await app.ctx.workflows.saasBatch.require(stagedJob.id, 'saas-owner')
    assert.equal(stagedFailed?.status, 'failed')
    assert.equal(stagedFailed?.items[0]?.primary_applied, true)
    assert.equal('dns_before_records' in (stagedFailed?.items[0] ?? {}), false)
    const stagedRaw = await app.ctx.platform.jobs.get(stagedJob.id)
    assert.ok(Array.isArray(stagedRaw?.items[0]?.dns_before_records), 'pre-update DNS snapshot was not persisted')
    await app.ctx.workflows.saasBatch.retryFailed(stagedJob.id, 'saas-owner')
    await app.ctx.platform.jobs.drain()
    const stagedRetried = await app.ctx.workflows.saasBatch.require(stagedJob.id, 'saas-owner')
    assert.equal(stagedRetried?.status, 'completed')
    assert.equal(stagedRemoteUpdates, 1, 'SaaS batch retry replayed an already-applied remote update')
    assert.equal(stagedCollectCalls, 1, 'SaaS batch retry recollected post-update DNS state')
    assert.deepEqual(stagedResyncBefore, stagedBeforeRecords, 'SaaS batch retry lost the pre-update DNS snapshot')
    stagedGateway.idByHostname = stagedOriginalId
    stagedGateway.show = stagedOriginalShow
    stagedGateway.update = stagedOriginalUpdate
    app.ctx.modules.saas.preferences.markOwnershipTxtCleaned = originalMarkOwnership
    stagedSync.collect = originalCollect
    stagedSync.resync = originalResync

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
    ]) {
      await app.ctx.modules.saas.preferences.setSyncConfig({
        cloudflareProviderId: 'cf-owner',
        identity: { zone: 'example.com', fqdn: hostname },
        hostnameId,
        syncTarget: 'dnspod',
        syncProviderId: 'dns-target',
        syncZone: 'example.com',
        autoPreferred: false,
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
      else await assert.rejects(deletion, (error: unknown) => error === failure)
      const localPreference = await app.ctx.modules.saas.preferences.get('cf-owner', {
        zone: 'example.com',
        fqdn: hostname,
      })
      assert.equal(localPreference === null, shouldClear, `${hostname} local preference clear policy`)
    }
    await app.ctx.modules.saas.preferences.setSyncConfig({
      cloudflareProviderId: 'cf-owner',
      identity: { zone: 'example.com', fqdn: 'delete-404.example.com' },
      hostnameId: 'delete-404-pref',
      syncTarget: 'dnspod',
      syncProviderId: 'dns-target',
      syncZone: 'example.com',
      autoPreferred: false,
    })
    hostnameGateway.idByHostname = async () => 'delete-404-pref'
    hostnameGateway.delete = async () => {
      throw new ApiError('saas_hostname_delete_failed', 'upstream hostname missing', 502, { upstream_status: 404 })
    }
    await app.ctx.modules.saas.hostnames.deleteHostname('saas-owner', 'example.com', 'delete-404.example.com')
    assert.equal(
      await app.ctx.modules.saas.preferences.get('cf-owner', { zone: 'example.com', fqdn: 'delete-404.example.com' }),
      null
    )
    hostnameGateway.idByHostname = originalIdByHostname
    hostnameGateway.delete = originalHostnameDelete

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

    // ---- reconcile HTTP 契约：GET /api/reconcile 与 GET /api/reconcile?refresh=true 都必须 200 ----
    // refresh 由前端 withRefresh 统一下发（sync-api.detect + useResourceQuery.refresh），
    // schema 里漏放行它会让「重新检测 / 一键修复后的刷新」全量 400；
    // 检测本身只读，这里把三条产品线的上游都固定在假数据上（EdgeOne 站点为空 → 无派生记录）
    const edgeOneZonesService = app.ctx.modules.edgeOne.zones
    const edgeOneDomainsService = app.ctx.modules.edgeOne.domains
    const originalEdgeZonesList = edgeOneZonesService.zones
    const originalEdgeDomainsList = edgeOneDomainsService.accelerationDomains
    const emptyEdgePage = async () => ({
      items: [],
      pagination: { page: 1, per_page: 0, offset: 0, limit: 0, count: 0, total: 0, total_count: 0, total_pages: 1 },
    })
    edgeOneZonesService.zones = emptyEdgePage as unknown as typeof edgeOneZonesService.zones
    edgeOneDomainsService.accelerationDomains =
      emptyEdgePage as unknown as typeof edgeOneDomainsService.accelerationDomains
    const createsBeforeDetect = customHostnameCreates
    const tunnelsBeforeDetect = tunnelCreates
    try {
      const detectHealth = await app.inject({ method: 'GET', url: '/api/reconcile', headers: { cookie } })
      assert.equal(
        detectHealth.statusCode,
        200,
        `GET /api/reconcile => ${detectHealth.statusCode}: ${detectHealth.body}`
      )
      const report = detectHealth.json().data
      assert.deepEqual(report.scope, {}, '无参检测的 scope 必须为空')
      assert.equal(typeof report.scanned_at, 'string')
      assert.equal(Number.isNaN(Date.parse(String(report.scanned_at))), false, '检测必须带可解析的 scanned_at')
      assert.ok(Array.isArray(report.items), '检测报告必须带 items 数组')
      assert.equal(report.summary.total, report.items.length, 'summary.total 必须与 items 一致')
      assert.equal('executed_at' in report, false, '只读检测响应不得带执行痕迹')

      const refreshed = await app.inject({ method: 'GET', url: '/api/reconcile?refresh=true', headers: { cookie } })
      assert.equal(
        refreshed.statusCode,
        200,
        `GET /api/reconcile?refresh=true => ${refreshed.statusCode}: ${refreshed.body}`
      )
      const notRefreshed = await app.inject({ method: 'GET', url: '/api/reconcile?refresh=false', headers: { cookie } })
      assert.equal(notRefreshed.statusCode, 200, `GET /api/reconcile?refresh=false => ${notRefreshed.statusCode}`)

      // 前端实际查询串（scopeParams + withRefresh）必须整串通过
      const frontendQuery = '/api/reconcile?provider_id=saas-owner&kind=saas-hostname&refresh=true'
      const scopedDetect = await app.inject({ method: 'GET', url: frontendQuery, headers: { cookie } })
      assert.equal(scopedDetect.statusCode, 200, `GET ${frontendQuery} => ${scopedDetect.statusCode}`)
      assert.deepEqual(scopedDetect.json().data.scope, { providerId: 'saas-owner', kind: 'saas-hostname' })

      // 反向控制：schema 仍是 additionalProperties:false，未知参数继续被拒
      const unknownQuery = await app.inject({ method: 'GET', url: '/api/reconcile?cache=true', headers: { cookie } })
      assert.equal(unknownQuery.statusCode, 400, 'reconcile 检测必须继续拒绝未知查询参数')

      // 检测 + 执行（无漂移项）都不得写远端
      assert.equal(customHostnameCreates, createsBeforeDetect, '检测创建了 SaaS 主机名')
      assert.equal(tunnelCreates, tunnelsBeforeDetect, '检测创建了隧道')
      assert.ok(customHostnameLists >= 1, '检测必须真正读取 SaaS 主机名列表')

      const apply = await app.inject({
        method: 'POST',
        url: '/api/reconcile',
        headers: { cookie },
        payload: { provider_id: 'saas-owner', kind: 'saas-hostname' },
      })
      assert.equal(apply.statusCode, 200, `POST /api/reconcile => ${apply.statusCode}: ${apply.body}`)
      const applied = apply.json().data
      assert.equal(typeof applied.executed_at, 'string', '执行必须带 executed_at')
      assert.deepEqual(applied.results, [], '无漂移项时不得产生写入结果')
      assert.equal(customHostnameCreates, createsBeforeDetect, '无漂移项的对账不得写远端')
    } finally {
      edgeOneZonesService.zones = originalEdgeZonesList
      edgeOneDomainsService.accelerationDomains = originalEdgeDomainsList
    }
  } finally {
    CloudflareClient.prototype.get = originalCloudflareGet
    CloudflareClient.prototype.post = originalCloudflarePost
  }

  const assertNoBatchInternals = (value: unknown, location = 'response'): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoBatchInternals(item, `${location}[${index}]`))
      return
    }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    for (const field of ['attempt', 'item_key', 'dns_before_records', 'cleanup_recipe']) {
      assert.equal(field in row, false, `${location} leaked ${field}`)
    }
    for (const [key, child] of Object.entries(row)) assertNoBatchInternals(child, `${location}.${key}`)
  }

  const internalItems = [
    {
      hostname: 'www.example.com',
      status: 'failed',
      attempt: 2,
      item_key: 'internal-item',
    },
  ]
  const presenterJobs: Array<{
    type: string
    payload: Record<string, unknown>
    url: string
    /** 另一个服务商下的同族路径：断言归属校验必须 404，且沿用本族 not_found 错误码 */
    foreign?: { url: string; code: string }
  }> = [
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
      url: '/api/saas/providers/missing/batch',
      foreign: { url: '/api/saas/providers/probe-other/batch', code: 'batch_job_not_found' },
    },
    {
      type: SAAS_BATCH_UPDATE_JOB,
      payload: { provider_id: 'missing', zone_name: 'example.com', patch: {} },
      url: '/api/saas/providers/missing/batch',
    },
    {
      type: PREFERRED_APPLY_JOB,
      payload: { provider_id: 'missing', zone_name: 'example.com', preferred_domain: 'target.example.com' },
      url: '/api/saas/providers/missing/preferred-apply',
      foreign: { url: '/api/saas/providers/probe-other/preferred-apply', code: 'preferred_apply_not_found' },
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
    const response = await app.inject({ method: 'GET', url: `${presenter.url}/${job.id}`, headers: { cookie } })
    assert.equal(response.statusCode, 200, `${presenter.type} presenter status`)
    assertNoBatchInternals(response.json().data, presenter.type)
    if (presenter.foreign) {
      const foreignRead = await app.inject({
        method: 'GET',
        url: `${presenter.foreign.url}/${job.id}`,
        headers: { cookie },
      })
      assert.equal(foreignRead.statusCode, 404, `${presenter.type} 跨服务商读取必须 404`)
      assert.equal(foreignRead.json().code, presenter.foreign.code, `${presenter.type} 归属失败须沿用本族错误码`)
      const foreignRetry = await app.inject({
        method: 'POST',
        url: `${presenter.foreign.url}/${job.id}/retry`,
        headers: { cookie },
      })
      assert.equal(foreignRetry.statusCode, 404, `${presenter.type} 跨服务商重试必须 404`)
      assert.equal(foreignRetry.json().code, presenter.foreign.code, `${presenter.type} 归属失败须沿用本族错误码`)
    }
  }

  // 反查（active）返回的每一条都必须能被同 providerId 的详情端点取到：HTTP 级组合链路
  const liveJob = await app.ctx.platform.jobs.create(
    DNS_BATCH_CREATE_JOB,
    {
      provider_type: 'dnspod',
      provider_id: 'missing',
      zone: 'example.com',
      resource_keys: ['dns:dnspod:missing:example.com'],
    },
    [{ name: 'live', type: 'A', value: '192.0.2.9' }],
    { start: false }
  )
  const liveActive = await app.inject({
    method: 'GET',
    url: '/api/dnspod/providers/missing/zones/example.com/records/batch/active',
    headers: { cookie },
  })
  assert.equal(liveActive.statusCode, 200, `DNS active => ${liveActive.statusCode}: ${liveActive.body}`)
  assert.equal(liveActive.json().data?.id, liveJob.id, 'DNS active 必须返回本族活跃任务')
  const liveDetail = await app.inject({
    method: 'GET',
    url: `/api/dnspod/providers/missing/records/batch/${liveJob.id}`,
    headers: { cookie },
  })
  assert.equal(liveDetail.statusCode, 200, `DNS job detail => ${liveDetail.statusCode}: ${liveDetail.body}`)
  assert.equal(liveDetail.json().data?.id, liveJob.id, '反查返回的任务必须能被同 providerId 的详情端点取到')
  const foreignActive = await app.inject({
    method: 'GET',
    url: '/api/saas/providers/missing/zones/example.com/batch/active',
    headers: { cookie },
  })
  assert.equal(foreignActive.statusCode, 200, `SaaS active => ${foreignActive.statusCode}: ${foreignActive.body}`)
  assert.equal(foreignActive.json().data, null, '别族面板不得反查出本族任务')

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
