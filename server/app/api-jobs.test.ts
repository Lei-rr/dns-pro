import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './lifecycle.js'
import type { AppConfig } from './config.js'
import { CloudflareClient } from '../modules/cloudflare/cloudflare.client.js'
import { DnsPodClient } from '../modules/dnspod/dns-pod.client.js'
import {
  DNS_BATCH_CREATE_JOB,
  DNS_BATCH_DELETE_JOB,
  DNS_BATCH_UPDATE_JOB,
  EDGEONE_BATCH_DELETE_JOB,
  EDGEONE_BATCH_DISABLE_JOB,
  PREFERRED_APPLY_JOB,
  SAAS_BATCH_DELETE_JOB,
  SAAS_BATCH_UPDATE_JOB,
  type JobType,
} from '../core/jobs/job-registry.js'

/**
 * 迁移自 scripts/isolated-api-probe.ts 的批量任务族部分：
 * 详情视图不泄漏内部执行字段、跨服务商归属校验、DNS 活跃任务反查，
 * 以及 SaaS 批量更新的阶段快照 / 重试不重放（顺序敏感，整段一个 it）。
 * 上游一律走客户端原型桩与工作流实例桩，不发真实网络请求。
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

/** 详情视图不得泄漏执行期内部字段（与 job.service 的内存剥离共用同一份清单） */
function expectNoBatchInternals(value: unknown, location = 'response'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectNoBatchInternals(item, `${location}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>
  for (const field of ['attempt', 'item_key', 'dns_before_records', 'cleanup_recipe']) {
    expect(field in row, `${location} leaked ${field}`).toBe(false)
  }
  for (const [key, child] of Object.entries(row)) expectNoBatchInternals(child, `${location}.${key}`)
}

let app: FastifyInstance
let sessionCookie = ''

const originalDnsPodCall = DnsPodClient.prototype.call
const originalCloudflareGet = CloudflareClient.prototype.get
const originalCloudflarePost = CloudflareClient.prototype.post

afterEach(() => {
  DnsPodClient.prototype.call = originalDnsPodCall
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
})

afterAll(async () => {
  await app.close()
})

describe('批量任务详情视图与归属校验', () => {
  const internalItems = [
    {
      hostname: 'www.example.com',
      status: 'failed',
      attempt: 2,
      item_key: 'internal-item',
    },
  ]
  const presenterJobs: Array<{
    type: JobType
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

  it('各族详情响应都不泄漏内部字段，跨服务商读取/重试一律 404', async () => {
    for (const presenter of presenterJobs) {
      const job = await app.ctx.platform.jobs.createTerminalExclusive(
        presenter.type,
        presenter.payload,
        internalItems,
        undefined,
        { status: 'failed', success: 0, failed: 1, skipped: 0, message: 'probe' }
      )
      const response = await app.inject({
        method: 'GET',
        url: `${presenter.url}/${job.id}`,
        headers: { cookie: sessionCookie },
      })
      expect(response.statusCode, `${presenter.type} presenter status`).toBe(200)
      expectNoBatchInternals(response.json().data, presenter.type)
      if (presenter.foreign) {
        const foreignRead = await app.inject({
          method: 'GET',
          url: `${presenter.foreign.url}/${job.id}`,
          headers: { cookie: sessionCookie },
        })
        expect(foreignRead.statusCode, `${presenter.type} 跨服务商读取必须 404`).toBe(404)
        expect(foreignRead.json().code, `${presenter.type} 归属失败须沿用本族错误码`).toBe(presenter.foreign.code)
        const foreignRetry = await app.inject({
          method: 'POST',
          url: `${presenter.foreign.url}/${job.id}/retry`,
          headers: { cookie: sessionCookie },
        })
        expect(foreignRetry.statusCode, `${presenter.type} 跨服务商重试必须 404`).toBe(404)
        expect(foreignRetry.json().code, `${presenter.type} 归属失败须沿用本族错误码`).toBe(presenter.foreign.code)
      }
    }
  })

  it('DNS 活跃任务反查与详情端点同口径，SaaS 探测不得命中别族任务', async () => {
    // 反查（active）与创建同一口径：按资源键交集判定（本族任务同样必须被本 providerId 的详情端点取到）
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
      headers: { cookie: sessionCookie },
    })
    expect(liveActive.statusCode, `DNS active => ${liveActive.statusCode}: ${liveActive.body}`).toBe(200)
    expect(liveActive.json().data?.id, 'DNS active 必须返回本族活跃任务').toBe(liveJob.id)

    const liveDetail = await app.inject({
      method: 'GET',
      url: `/api/dnspod/providers/missing/records/batch/${liveJob.id}`,
      headers: { cookie: sessionCookie },
    })
    expect(liveDetail.statusCode, `DNS job detail => ${liveDetail.statusCode}: ${liveDetail.body}`).toBe(200)
    expect(liveDetail.json().data?.id, '反查返回的任务必须能被同 providerId 的详情端点取到').toBe(liveJob.id)

    const foreignActive = await app.inject({
      method: 'GET',
      url: '/api/saas/providers/missing/zones/example.com/batch/active',
      headers: { cookie: sessionCookie },
    })
    expect(foreignActive.statusCode, `SaaS active => ${foreignActive.statusCode}: ${foreignActive.body}`).toBe(200)
    // SaaS 探测对不存在的服务商解析不出任何资源键，退化为 payload 字段判定：DNS 任务的 payload 没有 zone_name，不命中
    expect(foreignActive.json().data, 'SaaS 探测解析不出资源键时不得命中字段不同的别族任务').toBeNull()
  })
})

describe('SaaS 批量更新：阶段快照与重试', () => {
  /**
   * 顺序敏感：本地阶段失败 → 任务失败但远端更新不回滚 → 重试只补做未完成部分，
   * 必须复用同一份 DNS 快照与同一个远端更新计数，整段一个 it。
   */
  it('本地失败保留已应用的远端更新与更新前快照，重试不重复 PATCH、不重新采集', async () => {
    DnsPodClient.prototype.call = async function (action: string) {
      if (action === 'DescribeDomainList') {
        return {
          DomainList: [{ DomainId: 1, Name: 'example.com' }],
          DomainCountInfo: { DomainTotal: 1 },
          RequestId: 'dns-zones',
        }
      }
      if (action === 'DescribeRecordList') {
        return { RecordList: [], RecordCountInfo: { TotalCount: 0 }, RequestId: 'dns-records' }
      }
      throw new Error(`unexpected DNSPod action: ${action}`)
    }
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
      throw new Error(`Unexpected fake Cloudflare POST ${requestPath}`)
    }

    const hostnames = app.ctx.modules.saas.hostnames as unknown as {
      customHostnames: {
        idByHostname: (...args: unknown[]) => Promise<string>
        show: (...args: unknown[]) => Promise<Record<string, unknown>>
        update: (...args: unknown[]) => Promise<Record<string, unknown>>
      }
    }
    const gateway = hostnames.customHostnames
    const originalIdByHostname = gateway.idByHostname.bind(gateway)
    const originalShow = gateway.show.bind(gateway)
    const originalUpdate = gateway.update.bind(gateway)
    const originalMarkOwnership = app.ctx.modules.saas.preferences.markOwnershipTxtCleaned.bind(
      app.ctx.modules.saas.preferences
    )
    let stagedRemoteUpdates = 0
    let failLocalStage = true
    gateway.idByHostname = async () => 'batch-host'
    gateway.show = async () => ({
      id: 'batch-host',
      hostname: 'batch.example.com',
      custom_origin_server: 'old.example.com',
      status: 'active',
      ssl: {},
    })
    gateway.update = async () => {
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

    const syncGateway = (
      app.ctx.workflows.saasDnsSync as unknown as {
        sync: {
          collect: (...args: unknown[]) => Promise<{ hostname_fqdn: string; records: Record<string, unknown>[] }>
          resync: (...args: unknown[]) => Promise<Record<string, unknown>>
        }
      }
    ).sync
    const originalCollect = syncGateway.collect.bind(syncGateway)
    const originalResync = syncGateway.resync.bind(syncGateway)
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
    syncGateway.collect = async () => {
      stagedCollectCalls++
      return { hostname_fqdn: 'batch.example.com', records: stagedBeforeRecords }
    }
    syncGateway.resync = async (_provider, _zone, _hostname, beforeRecords) => {
      stagedResyncBefore = beforeRecords
      return { status: 'completed', records: [] }
    }

    try {
      const stagedJob = await app.ctx.workflows.saasBatch.createUpdate({
        providerId: 'saas-owner',
        zoneName: 'example.com',
        hostnames: ['batch.example.com'],
        patch: { custom_origin_server: 'new.example.com', auto_preferred: false },
        autoSync: true,
      })
      await app.ctx.platform.jobs.drain()
      const stagedFailed = await app.ctx.workflows.saasBatch.require(stagedJob.id, 'saas-owner')
      expect(stagedFailed?.status).toBe('failed')
      expect(stagedFailed?.items[0]?.primary_applied).toBe(true)
      expect('dns_before_records' in (stagedFailed?.items[0] ?? {})).toBe(false)
      const stagedRaw = await app.ctx.platform.jobs.get(stagedJob.id)
      expect(Array.isArray(stagedRaw?.items[0]?.dns_before_records), 'pre-update DNS snapshot was not persisted').toBe(
        true
      )

      await app.ctx.workflows.saasBatch.retryFailed(stagedJob.id, 'saas-owner')
      await app.ctx.platform.jobs.drain()
      const stagedRetried = await app.ctx.workflows.saasBatch.require(stagedJob.id, 'saas-owner')
      expect(stagedRetried?.status).toBe('completed')
      expect(stagedRemoteUpdates, 'SaaS batch retry replayed an already-applied remote update').toBe(1)
      expect(stagedCollectCalls, 'SaaS batch retry recollected post-update DNS state').toBe(1)
      expect(stagedResyncBefore, 'SaaS batch retry lost the pre-update DNS snapshot').toEqual(stagedBeforeRecords)
    } finally {
      gateway.idByHostname = originalIdByHostname
      gateway.show = originalShow
      gateway.update = originalUpdate
      app.ctx.modules.saas.preferences.markOwnershipTxtCleaned = originalMarkOwnership
      syncGateway.collect = originalCollect
      syncGateway.resync = originalResync
    }
  })
})
