import { describe, expect, it } from 'vitest'
import type { DnsRecordPort, DnsRecordRef } from '../../core/contracts/dns-record.port.js'
import type { DerivedOwner, RecordOwnership } from '../../core/contracts/ownership.port.js'
import type { DerivedSourcePlanner, PlannedRecord } from './derived-record.types.js'
import { DnsWriter } from './dns-writer.js'
import { tunnelDerivedPlanner } from './planners/tunnel.planner.js'
import { ReconcileService } from './reconcile.service.js'

/**
 * 迁移自 scripts/isolated-reconcile-probe.ts（F1/F2）。
 *
 * 两件事：只读检测不产生任何远端写（find 之后 create/update/remove 计数不变）；
 * 执行经 DnsWriter 且继承所有权门禁（冲突来源被 skipped，绝不落写）。
 * 归属门禁本身与同步计划的边界已在 ownership.test.ts / sync-plan.test.ts 覆盖，这里不重复。
 */

function createDnsPort(initial: DnsRecordRef[] = []) {
  const calls: string[] = []
  let records = initial
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
  return {
    port,
    calls,
    /** 远端写操作总数：find 是只读取证，不计入 */
    writes: () => calls.filter((call) => !call.startsWith('find:')).length,
    records: () => records,
  }
}

const writerFor = (port: DnsRecordPort, claims: readonly RecordOwnership[]) =>
  new DnsWriter({ dnspod: port, cloudflare: port }, { claimsFor: async () => [...claims] })

const claim = (fqdn: string, owner: DerivedOwner): RecordOwnership => ({ fqdn, owner, refId: 'other' })

function plannedRecord(fqdn: string, value: string, owner: 'tunnel' | 'saas' = 'saas'): PlannedRecord {
  return {
    source: { kind: owner === 'saas' ? 'saas-hostname' : 'tunnel-route', providerId: 'p1', id: fqdn },
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

const record = (id: string, name: string, value: string): DnsRecordRef => ({
  id,
  value: { type: 'CNAME', name, value, ttl: 300 },
})

describe('reconcile 检测与执行：只读检测零写、执行只写 create/update', () => {
  it('detect 不产生远端写，apply 经 DnsWriter 只处理缺失与漂移', async () => {
    const dnsPort = createDnsPort([record('r2', 'ok', 'target.example.net'), record('r3', 'drift', 'old.example.net')])
    const writer = writerFor(dnsPort.port, [])
    const planned: PlannedRecord[] = [
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
    const service = new ReconcileService(planners, { dnspod: dnsPort.port, cloudflare: dnsPort.port }, writer)

    // 1) 只读检测：状态判定 + 零写操作
    const before = dnsPort.writes()
    const report = await service.detect()
    expect(dnsPort.writes()).toBe(before)
    expect(report.items.map((item) => `${item.target.fqdn}=${item.status}`)).toEqual([
      'missing.example.com=missing',
      'ok.example.com=synced',
      'drift.example.com=drifted',
    ])
    expect(report.summary).toEqual({ total: 3, synced: 1, drifted: 1, missing: 1, failed: 0 })
    expect((report as { executed_at?: string }).executed_at).toBeUndefined()

    // 2) 执行：只写 create/update，不碰 unchanged
    const applied = await service.apply(report)
    expect(dnsPort.calls.filter((call) => !call.startsWith('find:'))).toEqual(['create:missing', 'update:drift'])
    expect(applied.results.map((result) => result.status)).toEqual(['created', 'updated'])
    expect(applied.items.map((item) => item.status)).toEqual(['synced', 'synced', 'synced'])
    expect(applied.executed_at).toBeTruthy()
  })
})

describe('reconcile 所有权门禁：执行继承 DnsWriter 的仲裁', () => {
  it('同名被其它产品线声明 → skipped（不落写），执行结果不冒充成功', async () => {
    const dnsPort = createDnsPort([record('r3', 'drift', 'old.example.net')])
    const guarded = new ReconcileService(
      [
        {
          kind: 'saas-hostname',
          async scan() {
            return [plannedRecord('drift.example.com', 'new.example.net', 'saas')]
          },
        },
      ],
      { dnspod: dnsPort.port, cloudflare: dnsPort.port },
      writerFor(dnsPort.port, [claim('drift.example.com', 'tunnel')])
    )

    const guardedReport = await guarded.detect()
    expect(guardedReport.items[0]?.status).toBe('drifted')
    const writesBeforeGuard = dnsPort.writes()
    const guardedResult = await guarded.apply(guardedReport)
    expect(guardedResult.results).toHaveLength(1)
    expect(guardedResult.results[0]?.status).toBe('skipped')
    expect(String(guardedResult.results[0]?.error)).toMatch(/^owner_mismatch:/)
    expect(dnsPort.writes()).toBe(writesBeforeGuard)
    expect(guardedResult.items[0]?.status).toBe('failed')
  })

  it('无主记录（manual）且未声明来源 → 同样拒绝自动写入', async () => {
    const dnsPort = createDnsPort([record('r3', 'drift', 'old.example.net')])
    const unownedPlanned: PlannedRecord[] = [
      {
        source: { kind: 'tunnel-route', providerId: 'cloudflared-1', id: 'tun-9' },
        target: {
          providerType: 'cloudflare',
          providerId: 'cf-1',
          zone: 'example.com',
          fqdn: 'drift.example.com',
        },
        owner: 'tunnel',
        purpose: 'tunnel_cname',
        desired: {
          purpose: 'tunnel_cname',
          fqdn: 'drift.example.com',
          owner: 'tunnel',
          record: { type: 'CNAME', value: 'x.cfargotunnel.com', ttl: 1, proxied: true },
        },
      },
    ]
    const unowned = new ReconcileService(
      [
        {
          kind: 'tunnel-route',
          async scan() {
            return unownedPlanned
          },
        },
      ],
      { dnspod: dnsPort.port, cloudflare: dnsPort.port },
      writerFor(dnsPort.port, [])
    )

    const unownedResult = await unowned.apply(await unowned.detect())
    expect(unownedResult.results[0]?.status).toBe('skipped')
    expect(String(unownedResult.results[0]?.error)).toMatch(/^unowned:/)
  })
})

describe('真实 tunnel planner：Ingress 路由 → 期望 CNAME', () => {
  it('扫描阶段零写，执行阶段只经 writer 写一次', async () => {
    const dnsPort = createDnsPort([])
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

    const writesBeforeScan = dnsPort.writes()
    const tunnelPlanned = await tunnelPlanner.scan({})
    expect(dnsPort.writes()).toBe(writesBeforeScan)
    expect(tunnelPlanned).toHaveLength(1)
    expect(tunnelPlanned[0]?.target.fqdn).toBe('edge.example.com')
    expect(tunnelPlanned[0]?.owner).toBe('tunnel')
    expect(tunnelPlanned[0]?.desired.record.value).toBe('tun-9.cfargotunnel.com')
    expect(tunnelPlanned[0]?.desired.record.proxied).toBe(true)

    // 引擎把 tunnel planner 的计划交给 writer：缺失 → create
    const tunnelService = new ReconcileService(
      [tunnelPlanner],
      { dnspod: dnsPort.port, cloudflare: dnsPort.port },
      writerFor(dnsPort.port, [claim('edge.example.com', 'tunnel')])
    )
    const tunnelReport = await tunnelService.detect()
    expect(tunnelReport.items[0]?.status).toBe('missing')
    const writesBeforeRepair = dnsPort.writes()
    const tunnelResult = await tunnelService.apply(tunnelReport)
    expect(tunnelResult.results[0]?.status).toBe('created')
    expect(dnsPort.writes() - writesBeforeRepair).toBe(1)
    expect(dnsPort.records()).toHaveLength(1)
  })
})
