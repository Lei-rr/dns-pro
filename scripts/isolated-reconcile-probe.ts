#!/usr/bin/env node
/**
 * F1/F2 探针：统一 reconcile 引擎。
 * 证明两件事——
 *  1. 只读检测不产生任何远端写操作（find 之后 create/update/remove 计数不变）；
 *  2. 执行经 DnsWriter，且继承所有权门禁（冲突来源被 skipped，绝不落写）。
 * 另外静态断言前端同步健康视图已接入（页面 + 路由 + 端点）。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { DnsRecordPort, DnsRecordRef } from '../server/src/kernel/contracts/dns-record.port.js'
import type { RecordOwnership } from '../server/src/kernel/contracts/ownership.port.js'
import type { DerivedSourcePlanner } from '../server/src/use-cases/derived-records/derived-record.types.js'
import { DnsWriter } from '../server/src/use-cases/derived-records/dns-writer.js'
import { tunnelDerivedPlanner } from '../server/src/use-cases/derived-records/planners/tunnel.planner.js'
import { ReconcileService } from '../server/src/use-cases/derived-records/reconcile.service.js'

const calls: string[] = []
const writes = () => calls.filter((call) => !call.startsWith('find:')).length

let records: DnsRecordRef[] = [
  {
    id: 'r2',
    value: { type: 'CNAME', name: 'ok', value: 'target.example.net', ttl: 300 },
  },
  {
    id: 'r3',
    value: { type: 'CNAME', name: 'drift', value: 'old.example.net', ttl: 300 },
  },
]

const port: DnsRecordPort = {
  async find(_providerId, _zone, probe) {
    calls.push(`find:${probe.name}:${probe.type ?? ''}`)
    return records.filter((ref) => ref.value.name === probe.name && ref.value.type === probe.type)
  },
  async create(_providerId, _zone, value) {
    calls.push(`create:${value.name}`)
    const created = { id: `created-${value.name}`, value }
    records = [...records, created]
    return created
  },
  async update(_providerId, _zone, recordId, value) {
    calls.push(`update:${value.name}`)
    records = records.map((ref) => (ref.id === recordId ? { id: recordId, value } : ref))
    return { id: recordId, value }
  },
  async remove(_providerId, _zone, recordId) {
    calls.push(`remove:${recordId}`)
    records = records.filter((ref) => ref.id !== recordId)
  },
}

const claim = (fqdn: string, owner: 'tunnel' | 'saas' | 'edgeone'): RecordOwnership => ({ fqdn, owner, refId: 'other' })
let claims: RecordOwnership[] = []
const ownership = { claimsFor: async () => claims }
const writer = new DnsWriter({ cloudflare: port }, ownership)

const planned = [
  plannedRecord('missing.example.com', 'new.example.net'),
  plannedRecord('ok.example.com', 'target.example.net'),
  plannedRecord('drift.example.com', 'new.example.net'),
]
const planners: DerivedSourcePlanner[] = [
  {
    kind: 'tunnel-route',
    async scan() {
      return planned
    },
  },
]
const service = new ReconcileService(planners, { cloudflare: port }, writer)

// 1) 只读检测：状态判定 + 零写操作
const before = writes()
const report = await service.detect()
assert.equal(writes(), before, 'detect must not write to the provider')
assert.deepEqual(
  report.items.map((item) => `${item.target.fqdn}=${item.status}`),
  ['missing.example.com=missing', 'ok.example.com=synced', 'drift.example.com=drifted']
)
assert.deepEqual(report.summary, { total: 3, synced: 1, drifted: 1, missing: 1, failed: 0 })
assert.equal(report.executed_at, undefined, 'detect returns a plain report without execution trace')

// 2) 执行：只写 create/update，不碰 unchanged
const applied = await service.apply(report)
assert.deepEqual(
  calls.filter((call) => !call.startsWith('find:')),
  ['create:missing', 'update:drift']
)
assert.deepEqual(
  applied.results.map((result) => result.status),
  ['created', 'updated']
)
assert.deepEqual(
  applied.items.map((item) => item.status),
  ['synced', 'synced', 'synced']
)
assert.ok(applied.executed_at && applied.executed_at !== '', 'apply must stamp executed_at')

// 3) 所有权门禁：同名被其它产品线声明 → skipped（不落写），不继承则视为 failed
records = [{ id: 'r3', value: { type: 'CNAME', name: 'drift', value: 'old.example.net', ttl: 300 } }]
claims = [claim('drift.example.com', 'tunnel')]
const guardedPlanned = [plannedRecord('drift.example.com', 'new.example.net', 'saas')]
const guarded = new ReconcileService(
  [
    {
      kind: 'saas-hostname',
      async scan() {
        return guardedPlanned
      },
    },
  ],
  { cloudflare: port },
  writer
)
const guardedReport = await guarded.detect()
assert.equal(guardedReport.items[0].status, 'drifted')
const writesBeforeGuard = writes()
const guardedResult = await guarded.apply(guardedReport)
const guardOutcomes = guardedResult.results
assert.equal(guardOutcomes.length, 1)
assert.equal(guardOutcomes[0].status, 'skipped', 'ownership conflict must be skipped')
assert.match(String(guardOutcomes[0].error), /^owner_mismatch:/)
assert.equal(writes(), writesBeforeGuard, 'skipped entry must not touch the provider')
assert.equal(guardedResult.items[0].status, 'failed')

// 4) 无主记录（manual）且未声明来源 → 同样拒绝自动写入
claims = []
const unowned = new ReconcileService(
  [
    {
      kind: 'tunnel-route',
      async scan() {
        return [
          {
            source: { kind: 'tunnel-route' as const, providerId: 'cloudflared-1', id: 'tun-9' },
            target: {
              providerType: 'cloudflare',
              providerId: 'cf-1',
              zone: 'example.com',
              fqdn: 'drift.example.com',
            },
            owner: 'tunnel' as const,
            purpose: 'tunnel_cname',
            desired: {
              purpose: 'tunnel_cname',
              fqdn: 'drift.example.com',
              owner: 'tunnel' as const,
              record: { type: 'CNAME', value: 'x.cfargotunnel.com', ttl: 1, proxied: true },
            },
          },
        ]
      },
    },
  ],
  { cloudflare: port },
  writer
)
const unownedResult = await unowned.apply(await unowned.detect())
assert.equal(unownedResult.results[0].status, 'skipped')
assert.match(String(unownedResult.results[0].error), /^unowned:/)

// 5) 真实 tunnel planner：Ingress 路由 → 期望 CNAME，且扫描阶段零写
const tunnelPlanner = tunnelDerivedPlanner({
  providers: {
    all: async () => [{ id: 'cloudflared-1', type: 'cloudflared', cloudflare_provider: 'cf-1' }],
  },
  tunnels: { list: async () => ({ items: [{ id: 'tun-9' }] }) },
  routes: {
    getConfig: async () => ({
      routes: [{ hostname: 'edge.example.com', service: 'http://127.0.0.1:8080', path: '' }],
      catch_all: 'http_status:404',
      version: 1,
    }),
  },
  catalog: { resolve: async () => ({ providerId: 'cf-1', zoneId: 'z1', zoneName: 'example.com' }) },
} as never)
const writesBeforeScan = writes()
const tunnelPlanned = await tunnelPlanner.scan({})
assert.equal(writes(), writesBeforeScan, 'planner scan must stay read-only')
assert.equal(tunnelPlanned.length, 1)
assert.equal(tunnelPlanned[0].target.fqdn, 'edge.example.com')
assert.equal(tunnelPlanned[0].owner, 'tunnel')
assert.equal(tunnelPlanned[0].desired.record.value, 'tun-9.cfargotunnel.com')
assert.equal(tunnelPlanned[0].desired.record.proxied, true)

// 6) 引擎把 tunnel planner 的计划交给 writer：缺失 → create
records = []
claims = [claim('edge.example.com', 'tunnel')]
const tunnelService = new ReconcileService([tunnelPlanner], { cloudflare: port }, writer)
const tunnelReport = await tunnelService.detect()
assert.equal(tunnelReport.items[0].status, 'missing')
const writesBeforeRepair = writes()
const tunnelResult = await tunnelService.apply(tunnelReport)
assert.equal(tunnelResult.results[0].status, 'created')
assert.equal(writes() - writesBeforeRepair, 1, 'repair must go through the writer exactly once')
assert.equal(records.length, 1)

// 7) 前端静态断言：健康视图页面 + 路由 + 端点接入
const root = new URL('../', import.meta.url)
const [page, router, layout] = await Promise.all(
  ['web/src/pages/sync/SyncPage.vue', 'web/src/app/router/index.ts', 'web/src/app/layouts/AppLayout.vue'].map(
    async (file) => await readFile(new URL(file, root), 'utf8')
  )
)
assert.match(page, /useSyncHealthQuery/, 'sync page must use the shared query layer')
assert.match(router, /SyncPage/, 'sync page must be registered in the router')
assert.match(layout, /sync/, 'app layout must expose the sync health entry')

function plannedRecord(fqdn: string, value: string, owner: 'tunnel' | 'saas' = 'saas') {
  return {
    source: {
      kind: owner === 'saas' ? ('saas-hostname' as const) : ('tunnel-route' as const),
      providerId: 'p1',
      id: fqdn,
    },
    target: { providerType: 'cloudflare', providerId: 'cf-1', zone: 'example.com', fqdn },
    owner,
    purpose: owner === 'saas' ? 'origin_cname' : 'tunnel_cname',
    desired: {
      purpose: owner === 'saas' ? 'origin_cname' : 'tunnel_cname',
      fqdn,
      owner,
      refId: owner === 'saas' ? fqdn : 'tun-9',
      record: { type: 'CNAME', value, ttl: 300 },
    },
  }
}

console.log('reconcile-probe=ok detect=read-only apply=writer ownership=inherited ui=wired')
