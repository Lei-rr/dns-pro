import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './lifecycle.js'
import type { AppConfig } from './config.js'
import { DnsWriter } from '../workflows/derived-records/dns-writer.js'
import { dnsPodRecordPort } from '../modules/dnspod/dns/dns-pod-record.adapter.js'
import { DnsPodClient } from '../modules/dnspod/dns-pod.client.js'
import { DnsPodRecordService } from '../modules/dnspod/dns-pod-record.service.js'
import { dnsRecordMatches, type DnsProviderType, type DnsRecordPort } from '../core/contracts/dns-record.port.js'
import type { RecordOwnership } from '../core/contracts/ownership.port.js'
import { EdgeOneClient } from '../modules/edge-one/edge-one.client.js'
import { ApiError } from '../core/http/api-error.js'
import { EDGEONE_BATCH_DELETE_JOB } from '../core/jobs/job-registry.js'

/**
 * 迁移自 scripts/isolated-api-probe.ts 的 DNS / EdgeOne 记录端点部分：
 * DNSPod 记录适配器的生产链匹配与冲突预清理、EdgeOne 加速域名创建/删除时的 DNSPod 副作用与缓存失效、
 * 以及 Cloudflare/DNSPod 批量记录端点的入队契约。
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

let app: FastifyInstance
let sessionCookie = ''

const originalDnsPodCall = DnsPodClient.prototype.call
const originalEdgeOneCall = EdgeOneClient.prototype.call

afterEach(() => {
  DnsPodClient.prototype.call = originalDnsPodCall
  EdgeOneClient.prototype.call = originalEdgeOneCall
})

beforeAll(async () => {
  const started = await startApp()
  app = started.app
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: ADMIN })
  if (login.statusCode !== 200) throw new Error(`fixture login failed: ${login.statusCode} ${login.body}`)
  sessionCookie = cookieOf(login)

  await app.ctx.workflows.providerManagement.create({
    id: 'dns-target',
    name: 'DNS target',
    type: 'dnspod',
    secret_id: 'probe-secret-id',
    secret_key: 'probe-secret-key',
  })
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
})

afterAll(async () => {
  await app.close()
})

describe('DNSPod 记录适配器与冲突预清理', () => {
  it('生产链按稳定 line_id 匹配记录，而不是按线路名', async () => {
    DnsPodClient.prototype.call = async function (action: string) {
      expect(action).toBe('DescribeRecordList')
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
    expect(exact, 'DNSPod adapter production chain did not prefer stable line_id').not.toBeNull()
  })

  it('预清理只删除冲突类型，默认 NS 与人工记录不动', async () => {
    const precleanDeleted: number[] = []
    DnsPodClient.prototype.call = async function (action: string, payload: Record<string, unknown> = {}) {
      if (action === 'DeleteRecord') {
        precleanDeleted.push(Number(payload.RecordId))
        return { RequestId: 'deleted' }
      }
      expect(action).toBe('DescribeRecordList')
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

    const claims: RecordOwnership[] = [{ fqdn: 'example.com', owner: 'saas', refId: 'probe-preclean' }]
    const writer = new DnsWriter(
      // preclean 只走 dnspod 端口；cloudflare 槽位不会在本用例被读取
      { dnspod: dnsPodRecordPort(app.ctx.modules.dnsPod.records) } as unknown as Record<DnsProviderType, DnsRecordPort>,
      { claimsFor: async () => claims }
    )
    const cleaned = await writer.preclean(
      'dnspod',
      'dns-target',
      'example.com',
      { fqdn: 'example.com', type: 'CNAME' },
      'saas'
    )
    expect(
      cleaned.map((item) => item.record_id),
      `预清理只应删除冲突的 A 记录：${JSON.stringify(cleaned)}`
    ).toEqual(['11'])
    expect(precleanDeleted, '预清理不得删除默认 NS 记录').toEqual([11])
  })
})

describe('EdgeOne 加速域名与 DNSPod 记录联动', () => {
  /**
   * 顺序敏感：创建 → 缓存失效 → 删除的 CNAME 预取失败 → 批量删除失败与重试 → 历史作业重试，
   * 共享同一组上游计数器（主删除次数 / 记录列表次数），必须在一个 it 内连续推进。
   */
  it('创建不因 CNAME 查询失败而回滚，删除按阶段推进且重试不重放主删除', async () => {
    let edgeZoneLoads = 0
    let edgeDomainLoads = 0
    let edgeCreateCalls = 0
    let primaryDeleteCalls = 0
    let failDeleteCnameLookup = false
    let dnsRecordLists = 0
    const edgeDeletedRecordIds: number[] = []

    EdgeOneClient.prototype.call = async function (action: string, payload: Record<string, unknown>) {
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
      throw new Error(`unexpected EdgeOne action: ${action}`)
    }

    DnsPodClient.prototype.call = async function (action: string, payload: Record<string, unknown> = {}) {
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
      throw new Error(`unexpected DNSPod action: ${action}`)
    }

    const createdWithPendingCname = await app.ctx.workflows.edgeOneDnsSync.createAccelerationDomain(
      'edge-owner',
      'zone-1',
      { domain_name: 'pending.example.com', origin: '192.0.2.10' },
      true
    )
    expect(edgeCreateCalls).toBe(1)
    expect(createdWithPendingCname.name).toBe('pending.example.com')
    const createSideEffects = createdWithPendingCname.side_effects as
      { dns?: { sync?: { status?: string } } } | undefined
    expect(
      createSideEffects?.dns?.sync?.status,
      'post-create CNAME lookup failure hid a successful primary create'
    ).toBe('failed')

    await app.ctx.modules.edgeOne.zones.zones('edge-owner')
    await app.ctx.modules.edgeOne.zones.zones('edge-owner')
    await app.ctx.modules.edgeOne.domains.accelerationDomains('edge-owner', 'zone-1')
    await app.ctx.modules.edgeOne.domains.accelerationDomains('edge-owner', 'zone-1')
    expect(edgeZoneLoads, 'EdgeOne zone cache did not hit before linked-provider update').toBe(1)
    expect(edgeDomainLoads, 'EdgeOne domain cache did not hit before linked-provider update').toBe(1)
    await app.ctx.workflows.providerManagement.update('edge-dns', { secret_key: 'edge-key-v2' })
    await app.ctx.modules.edgeOne.zones.zones('edge-owner')
    await app.ctx.modules.edgeOne.domains.accelerationDomains('edge-owner', 'zone-1')
    expect(edgeZoneLoads, 'linked DNSPod provider update did not evict EdgeOne zone cache').toBe(2)
    expect(edgeDomainLoads, 'linked DNSPod provider update did not evict EdgeOne domain cache').toBe(2)

    const deletesBeforeLookupFailure = primaryDeleteCalls
    failDeleteCnameLookup = true
    await app.ctx.workflows.providerManagement.update('edge-dns', { secret_key: 'edge-key-v3' })
    await expect(
      app.ctx.workflows.edgeOneDnsSync.deleteAccelerationDomain('edge-owner', 'zone-1', 'www.example.com', true)
    ).rejects.toMatchObject({ code: 'edgeone_request_failed' })
    failDeleteCnameLookup = false
    expect(primaryDeleteCalls, 'EdgeOne primary delete ran after CNAME cleanup lookup failed').toBe(
      deletesBeforeLookupFailure
    )

    const failedDelete = await app.ctx.workflows.edgeOneBatch.createDelete({
      providerId: 'edge-owner',
      zoneId: 'zone-1',
      domains: ['www.example.com'],
      autoCleanup: true,
    })
    await app.ctx.platform.jobs.drain()
    const failedDeleteState = await app.ctx.workflows.edgeOneBatch.find(failedDelete.id)
    expect(failedDeleteState?.status).toBe('failed')
    expect(failedDeleteState?.items[0]?.primary_deleted).toBe(true)
    expect(failedDeleteState?.items[0]?.dns_cleanup_status).toBe('failed')
    expect(primaryDeleteCalls).toBe(1)

    await app.ctx.workflows.edgeOneBatch.retryFailed(failedDelete.id)
    await app.ctx.platform.jobs.drain()
    const retriedDeleteState = await app.ctx.workflows.edgeOneBatch.find(failedDelete.id)
    expect(retriedDeleteState?.status).toBe('completed')
    expect(retriedDeleteState?.items[0]?.status).toBe('success')
    expect(retriedDeleteState?.items[0]?.primary_deleted).toBe(true)
    expect(retriedDeleteState?.items[0]?.dns_cleanup_status).toBe('completed')
    expect(primaryDeleteCalls, 'retry replayed an already-completed EdgeOne delete stage').toBe(1)

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
    expect(missingDeleteState?.status).toBe('completed')
    expect(missingDeleteState?.items[0]?.status).toBe('success')
    expect(missingDeleteState?.items[0]?.primary_deleted).toBe(true)
    expect(missingDeleteState?.items[0]?.dns_cleanup_status).toBe('completed')
    expect(edgeDeletedRecordIds.includes(900), '清理误删了人工添加的同名记录').toBe(false)
  })
})

describe('批量记录端点入队契约', () => {
  it('Cloudflare 批量创建/删除/更新接受新载荷并返回 201', async () => {
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
      const response = await app.inject({
        method: 'POST',
        url: batch.url,
        headers: { cookie: sessionCookie },
        payload: batch.payload,
      })
      expect(response.statusCode, batch.url).toBe(201)
      await app.ctx.platform.jobs.drain()
    }
  })
})
