#!/usr/bin/env node
// 请求量守卫：确认同步/批量路径把过滤下推上游，且不随条目数重复全量拉取
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { CloudflareClient } from '../server/src/modules/cloudflare/cloudflare.client.js'
import { DnsPodClient } from '../server/src/modules/dns-pod/dns-pod.client.js'
import { EdgeOneClient } from '../server/src/modules/edge-one/edge-one.client.js'
import { setDataRoot } from '../server/src/platform/storage/json-store.js'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-requests-'))
await fs.writeFile(
  path.join(dataDir, 'config.json'),
  JSON.stringify({ auth: { username: 'probe', password: 'probe-password' } }, null, 2)
)
setDataRoot(dataDir)

const app = await buildApp({
  host: '127.0.0.1',
  port: 0,
  logLevel: false,
  dataDir,
  sessionSecret: 'requests-probe-secret-longer-than-thirty-two-characters',
  sessionCookieName: 'requests_probe',
  sessionMaxAgeSeconds: 3600,
  cookieSecure: false,
  cookieSameSite: 'lax',
  trustProxy: false,
  httpTimeoutMs: 1000,
})

// 记录上游请求
const dnsPodCalls: Array<{ action: string; payload: Record<string, unknown> }> = []
const edgeOneActions: string[] = []
const cloudflareGets: Array<{ path: string; params: Record<string, unknown> }> = []

try {
  await app.ready()
  for (const provider of [
    { id: 'dns-target', type: 'dnspod', secret_id: 'id', secret_key: 'key' },
    { id: 'cf-owner', type: 'cloudflare', api_token: 'token', account_id: 'acct' },
    {
      id: 'saas-owner',
      type: 'saas',
      cloudflare_provider: 'cf-owner',
      dnspod_provider: 'dns-target',
      cloudflare_dns_provider: 'cf-owner',
    },
    { id: 'edge-owner', type: 'edgeone', dnspod_provider: 'dns-target' },
  ]) {
    await app.ctx.workflows.providerManagement.create(provider)
  }

  // ---- 1. DNSPod 过滤下推：同步时带上 Subdomain/RecordType，且不整站分页拉取 ----
  DnsPodClient.prototype.call = async function (
    action: string,
    payload: Record<string, unknown> = {}
  ): Promise<unknown> {
    dnsPodCalls.push({ action, payload })
    if (action === 'DescribeRecordList') {
      return {
        RecordList: [{ RecordId: 1, Name: 'www', Type: 'CNAME', Value: 'origin.example.net', Line: '默认' }],
        RecordCountInfo: { TotalCount: 1 },
        RequestId: 'records',
      }
    }
    if (action === 'DescribeDomainList') {
      return {
        DomainList: [{ DomainId: 1, Name: 'example.com', Grade: 'D_FREE' }],
        DomainCountInfo: { DomainTotal: 1 },
      }
    }
    if (action === 'DescribeRecordLineList') {
      return {
        LineList: [
          { Name: '默认', LineId: '0' },
          { Name: '电信', LineId: '10' },
        ],
        LineGroupList: [{ Name: '境内', LineId: '1', Type: 'group' }],
        RequestId: 'lines',
      }
    }
    if (action === 'CreateRecord') return { RecordId: 42, RequestId: 'created' }
    assert.fail(`unexpected DNSPod action: ${action}`)
  }

  await app.ctx.modules.dnsPod.recordSync.sync('dns-target', 'example.com', {
    type: 'CNAME',
    name: 'www.example.com',
    value: 'origin.example.net',
    line: '默认',
    purpose: 'origin_cname',
    provider_id: 'dns-target',
  })
  const recordLists = dnsPodCalls.filter((call) => call.action === 'DescribeRecordList')
  assert.equal(recordLists.length, 1, '同步不应重复分页拉取记录列表')
  assert.equal(recordLists[0]?.payload.Subdomain, 'www', 'DNSPod 查询必须把主机记录下推上游')
  assert.equal(recordLists[0]?.payload.RecordType, 'CNAME', 'DNSPod 查询必须把记录类型下推上游')

  // 列表分页使用上游允许的最大单页（3000），减少大域名的往返次数
  dnsPodCalls.length = 0
  await app.ctx.modules.dnsPod.records.list('dns-target', 'example.com')
  const listCall = dnsPodCalls.find((call) => call.action === 'DescribeRecordList')
  assert.equal(listCall?.payload.Limit, 3000, 'DNSPod 列表分页应使用最大单页')

  // ---- 线路列表：按域名套餐查询，供前端动态渲染 ----
  dnsPodCalls.length = 0
  const lines = await app.ctx.modules.dnsPod.lines.lines('dns-target', 'example.com')
  assert.deepEqual(
    lines.items.map((line) => line.name),
    ['默认', '电信'],
    '线路列表应来自上游'
  )
  assert.equal(lines.items[0]?.line_id, '0')
  assert.deepEqual(
    lines.groups.map((group) => group.name),
    ['境内'],
    '线路分组应一并返回'
  )
  const lineCall = dnsPodCalls.find((call) => call.action === 'DescribeRecordLineList')
  assert.equal(lineCall?.payload.DomainGrade, 'D_FREE', '线路查询需要带域名套餐等级')

  // ---- 2. Cloudflare 精确匹配：使用 name 参数，不再用模糊 search ----
  const cloudflareHostnames = ['a.example.com', 'b.example.com', 'c.example.com']
  CloudflareClient.prototype.get = async function (
    requestPath: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    cloudflareGets.push({ path: requestPath, params })
    if (requestPath.endsWith('/dns_records')) {
      return {
        success: true,
        result: [{ id: 'rec-1', name: 'www.example.com', type: 'CNAME', content: 'origin.example.net' }],
        result_info: { page: 1, per_page: 100, total_pages: 1 },
      }
    }
    if (requestPath === 'zones') {
      return {
        success: true,
        result: [{ id: 'zone-1', name: 'example.com' }],
        result_info: { page: 1, per_page: 100, total_pages: 1 },
      }
    }
    if (requestPath.endsWith('/custom_hostnames')) {
      return {
        success: true,
        result: cloudflareHostnames.map((hostname) => ({
          id: `id-${hostname}`,
          hostname,
          status: 'active',
          ssl: {},
        })),
        result_info: { page: 1, per_page: 100, total_pages: 1 },
      }
    }
    if (requestPath.endsWith('/fallback_origin')) return { success: true, result: { origin: null, status: null } }
    if (requestPath.endsWith('/dcv_delegation/uuid')) return { success: true, result: { uuid: 'uuid-1' } }
    if (requestPath.includes('/custom_hostnames/')) {
      const id = requestPath.split('/').pop() ?? ''
      return { success: true, result: { id, hostname: id.replace(/^id-/, ''), status: 'active', ssl: {} } }
    }
    assert.fail(`unexpected Cloudflare GET ${requestPath}`)
  }

  const beforeExact = cloudflareGets.length
  await app.ctx.modules.cloudflare.records.findExact('cf-owner', 'zone-1', 'www.example.com', 'CNAME')
  const exactCalls = cloudflareGets.slice(beforeExact)
  assert.equal(exactCalls.length, 1, 'findExact 应单次请求完成')
  assert.equal(exactCalls[0]?.params.name, 'www.example.com', 'findExact 必须使用精确 name 参数')
  assert.equal(exactCalls[0]?.params.search, undefined, 'findExact 不应使用模糊 search 参数')

  // ---- 3. SaaS 批量删除：主机名列表只拉一次，不随条目数放大 ----
  cloudflareGets.length = 0
  const listGets = () => cloudflareGets.filter((call) => call.path.endsWith('/custom_hostnames')).length
  const detailGets = () =>
    cloudflareGets.filter((call) => call.path.includes('/custom_hostnames/') && !call.path.endsWith('/fallback_origin'))
      .length

  CloudflareClient.prototype.delete = async function (requestPath: string): Promise<unknown> {
    if (requestPath.endsWith('/custom_hostnames/')) return { success: true, result: {} }
    if (requestPath.includes('/custom_hostnames/')) return { success: true, result: {} }
    assert.fail(`unexpected Cloudflare DELETE ${requestPath}`)
  }

  const batch = await app.ctx.workflows.saasBatch.createDelete({
    providerId: 'saas-owner',
    zoneName: 'example.com',
    hostnames: cloudflareHostnames,
    autoCleanup: true,
  })
  await app.ctx.platform.jobs.drain()
  const finished = await app.ctx.workflows.saasBatch.find(batch.id)
  assert.equal(finished?.status, 'completed', finished?.message)
  assert.equal(listGets(), 1, `主机名列表应只拉取一次，实际 ${listGets()} 次`)
  assert.ok(detailGets() <= cloudflareHostnames.length, `详情请求应每主机名一次，实际 ${detailGets()} 次`)

  // ---- 4. EdgeOne 批量删除：加速域名列表只拉一次 ----
  EdgeOneClient.prototype.call = async function (action: string): Promise<unknown> {
    edgeOneActions.push(action)
    if (action === 'DescribeAccelerationDomains') {
      return {
        AccelerationDomains: [
          { ZoneId: 'zone-1', DomainName: 'a.example.com', Cname: 'a.example.com.eo.dnse5.com' },
          { ZoneId: 'zone-1', DomainName: 'b.example.com', Cname: 'b.example.com.eo.dnse5.com' },
        ],
        TotalCount: 2,
        RequestId: 'domains',
      }
    }
    if (action === 'DeleteAccelerationDomains') return { RequestId: 'deleted' }
    if (action === 'DescribeRecordList') return { RecordList: [], RecordCountInfo: { TotalCount: 0 } }
    if (action === 'DescribeDomainList') {
      return { DomainList: [{ DomainId: 1, Name: 'example.com' }], DomainCountInfo: { DomainTotal: 1 } }
    }
    assert.fail(`unexpected EdgeOne action: ${action}`)
  }
  edgeOneActions.length = 0
  const edgeBatch = await app.ctx.workflows.edgeOneBatch.createDelete({
    providerId: 'edge-owner',
    zoneId: 'zone-1',
    domains: ['a.example.com', 'b.example.com'],
    autoCleanup: true,
  })
  await app.ctx.platform.jobs.drain()
  const edgeFinished = await app.ctx.workflows.edgeOneBatch.find(edgeBatch.id)
  assert.equal(edgeFinished?.status, 'completed', edgeFinished?.message)
  assert.equal(
    edgeOneActions.filter((action) => action === 'DescribeAccelerationDomains').length,
    1,
    '加速域名列表应只拉取一次（任务级快照）'
  )

  // ---- 5. 跨工作流互斥：同一底层 DNS 资源不能并发写入 ----
  const deferred: { resolve: () => void } = { resolve: () => undefined }
  const gate = new Promise<void>((resolve) => {
    deferred.resolve = resolve
    // 兜底：断言失败时也要能收敛，避免 close() 一直等待在途任务
    setTimeout(resolve, 3000).unref()
  })
  DnsPodClient.prototype.call = async function (action: string): Promise<unknown> {
    if (action === 'DescribeRecordList') {
      return { RecordList: [], RecordCountInfo: { TotalCount: 0 }, RequestId: 'lock' }
    }
    if (action === 'CreateRecord') {
      await gate
      return { RecordId: 7, RequestId: 'created' }
    }
    if (action === 'DescribeDomainList') {
      return {
        DomainList: [{ DomainId: 1, Name: 'example.com', Grade: 'D_FREE' }],
        DomainCountInfo: { DomainTotal: 1 },
      }
    }
    assert.fail(`unexpected DNSPod action: ${action}`)
  }

  const dnsJob = await app.ctx.workflows.dnsBatch.createCreate({
    providerType: 'dnspod',
    providerId: 'dns-target',
    zone: 'example.com',
    records: [{ name: 'lock', type: 'A', value: '192.0.2.1' }],
  })
  const dnsRaw = await app.ctx.platform.jobs.get(dnsJob.id)
  assert.deepEqual(
    dnsRaw?.payload.resource_keys,
    ['dns:dnspod:dns-target:example.com'],
    'DNS 批量任务必须登记底层写入资源键'
  )

  // SaaS 批量写回同一个 DNSPod 域名 → 必须被拒
  const conflict = await app.ctx.workflows.saasBatch
    .createDelete({
      providerId: 'saas-owner',
      zoneName: 'example.com',
      hostnames: ['x.example.com'],
      autoCleanup: true,
    })
    .then(
      () => null,
      (error: unknown) => error as { code?: string }
    )
  assert.equal(conflict?.code, 'batch_job_running', '同一底层 DNS 域名上的 SaaS 批量必须被互斥拦截')

  // 不同站点不应被误锁
  const otherZone = await app.ctx.workflows.dnsBatch.createCreate({
    providerType: 'dnspod',
    providerId: 'dns-target',
    zone: 'other.example.com',
    records: [{ name: 'ok', type: 'A', value: '192.0.2.2' }],
  })
  assert.ok(otherZone.id, '不同站点不应被误判为冲突')

  deferred.resolve()
  await app.ctx.platform.jobs.drain()

  console.log(
    'batch-request-probe=ok dnspod=upstream-filter cloudflare=exact-name saas=o(n) edgeone=snapshot lock=resource-keys'
  )
} finally {
  // 断言失败时可能有任务仍在等待上游：close 加超时，保证失败能正常退出
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 3000))])
  await fs.rm(dataDir, { recursive: true, force: true })
}
