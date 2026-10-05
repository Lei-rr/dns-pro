import { describe, expect, it } from 'vitest'
import type { DnsRecordRef, DnsRecordValue } from '../../core/contracts/dns-record.port.js'
import { planSync, recordIdentity, recordProbe, type DesiredRecord } from './sync-plan.js'

/** 期望记录：EdgeOne 加速域名的 CNAME 派生（D1 端口视角下 name 是相对主机记录） */
function desired(overrides: Partial<DesiredRecord> = {}): DesiredRecord {
  return {
    purpose: 'edgeone_cname',
    fqdn: 'www.example.com',
    record: { type: 'CNAME', value: 'target.edgeone.net' },
    owner: 'edgeone',
    refId: 'domain-1',
    ...overrides,
  }
}

function current(id: string, value: Partial<DnsRecordValue> = {}): DnsRecordRef {
  return { id, value: { type: 'CNAME', name: 'www', value: 'target.edgeone.net', ...value } }
}

function plan(desiredRecords: DesiredRecord[], currentRecords: DnsRecordRef[]) {
  return planSync({
    providerType: 'dnspod',
    providerId: 'provider-1',
    zone: 'example.com',
    desired: desiredRecords,
    current: currentRecords,
  })
}

describe('记录身份与查询条件（写入与只读检测共用同一判据）', () => {
  it('记录身份：类型大写 + 主机名小写去尾点 + 线路（line 优先、回退 lineId）', () => {
    expect(recordIdentity({ type: 'cname', name: 'WWW.example.com.', value: 'x' })).toBe('CNAME|www.example.com|')
    expect(recordIdentity({ type: 'A', name: 'www', value: '1.2.3.4', lineId: '10' })).toBe('A|www|10')
    expect(recordIdentity({ type: 'A', name: 'www', value: '1.2.3.4', line: '默认', lineId: '10' })).toBe('A|www|默认')
  })

  it('查询条件：FQDN 归一为相对主机记录、类型默认 A 并大写、线路与线路 ID 只在非空时携带', () => {
    expect(recordProbe('WWW.Example.com.', 'example.com', { type: 'cname' })).toEqual({ name: 'www', type: 'CNAME' })
    expect(recordProbe('example.com', 'example.com', { type: 'A', line: ' 默认 ', lineId: '' })).toEqual({
      name: '@',
      type: 'A',
      line: '默认',
    })
    expect(recordProbe('www.example.com', 'example.com', { type: '', line: '', lineId: '10' })).toEqual({
      name: 'www',
      type: 'A',
      lineId: '10',
    })
  })
})

describe('同步计划：期望 × 现状 → 计划（纯函数，无 IO）', () => {
  it('期望与现状完全一致 → unchanged，并携带命中的现状记录', () => {
    const existing = current('rec-1')
    expect(plan([desired()], [existing]).entries).toEqual([
      {
        purpose: 'edgeone_cname',
        action: 'unchanged',
        fqdn: 'www.example.com',
        record: { type: 'CNAME', value: 'target.edgeone.net' },
        owner: 'edgeone',
        refId: 'domain-1',
        existing,
      },
    ])
  })

  it('同一槽位但 TTL 不同 → update（值相同仍视为同一条记录的另一版本）', () => {
    const existing = current('rec-1', { ttl: 600 })
    const result = plan([desired({ record: { type: 'CNAME', value: 'target.edgeone.net', ttl: 60 } })], [existing])
    expect(result.entries.map((entry) => entry.action)).toEqual(['update'])
    expect(result.entries[0]?.existing).toBe(existing)
  })

  it('槽位存在但值已过期 → update 覆盖该槽位而不是新建', () => {
    const stale = current('rec-1', { value: 'old.edgeone.net' })
    expect(plan([desired()], [stale]).entries.map((entry) => entry.action)).toEqual(['update'])
  })

  it('槽位无记录 → create，且不携带 existing', () => {
    const entries = plan([desired()], []).entries
    expect(entries.map((entry) => entry.action)).toEqual(['create'])
    expect(entries[0]?.existing).toBeUndefined()
  })

  it('FQDN 归一生效：大小写与尾点差异不影响命中', () => {
    expect(plan([desired({ fqdn: 'WWW.Example.com.' })], [current('rec-1')]).entries.map((e) => e.action)).toEqual([
      'unchanged',
    ])
  })

  it('计划头保留 provider 与 zone，entries 顺序与期望顺序一致', () => {
    const result = plan(
      [desired(), desired({ purpose: 'saas_origin', fqdn: 'origin.example.com' })],
      [current('rec-1')]
    )
    expect({ providerType: result.providerType, providerId: result.providerId, zone: result.zone }).toEqual({
      providerType: 'dnspod',
      providerId: 'provider-1',
      zone: 'example.com',
    })
    expect(result.entries.map((entry) => entry.purpose)).toEqual(['edgeone_cname', 'saas_origin'])
  })

  it('空期望 → 空计划（不触碰任何现状记录）', () => {
    expect(plan([], [current('rec-1')]).entries).toEqual([])
  })
})

describe('清理判定：只认「能证明归属」的记录，归属不明一律不动', () => {
  it('期望删除且值相同 → delete', () => {
    const existing = current('rec-1')
    const result = plan([desired({ keep: false })], [existing])
    expect(result.entries.map((entry) => entry.action)).toEqual(['delete'])
    expect(result.entries[0]?.existing).toBe(existing)
  })

  it('期望删除且备注与声明一致（值已变更）→ delete', () => {
    const existing = current('rec-1', { value: 'old.edgeone.net', note: 'edgeone:domain-1' })
    const want = desired({ keep: false, record: { type: 'CNAME', value: 'new.edgeone.net', note: 'edgeone:domain-1' } })
    expect(plan([want], [existing]).entries.map((entry) => entry.action)).toEqual(['delete'])
  })

  it('期望删除但值不同且备注对不上（人工记录）→ 不产生任何动作', () => {
    const manual = current('rec-1', { value: 'manual.example.com', note: '人工维护' })
    const want = desired({ keep: false, record: { type: 'CNAME', value: 'new.edgeone.net', note: 'edgeone:domain-1' } })
    expect(plan([want], [manual]).entries).toEqual([])
  })

  it('期望删除且现状无对应槽位 → 不产生任何动作', () => {
    expect(plan([desired({ keep: false })], []).entries).toEqual([])
  })
})

describe('槽位占用与线路身份（避免重复写入的两个边界）', () => {
  it('两条期望争抢同一现状记录时，后一条只能 create（现状记录已被认领）', () => {
    const existing = current('rec-1')
    const entries = plan([desired(), desired({ purpose: 'saas_origin' })], [existing]).entries
    expect(entries.map((entry) => entry.action)).toEqual(['unchanged', 'create'])
  })

  it('线路身份两侧必须对称：现状只带 lineId、期望只声明 line 时不视为同一槽位', () => {
    const existing = current('rec-1', { type: 'A', value: '1.2.3.4', lineId: '10' })
    const want = desired({ record: { type: 'A', value: '1.2.3.4', line: '默认' } })
    expect(plan([want], [existing]).entries.map((entry) => entry.action)).toEqual(['create'])
  })
})

/** P1 探针迁移（原 scripts/isolated-sync-plan-probe.ts）：清理归属、值尾点与槽位复用边界 */
describe('清理归属与槽位复用的边界（探针迁移补充）', () => {
  it('值/备注/TTL 全同 → unchanged，不重复创建', () => {
    const existing = current('rec-1', { ttl: 600, note: 'edgeone:domain-1' })
    const want = desired({
      record: { type: 'CNAME', value: 'target.edgeone.net', ttl: 600, note: 'edgeone:domain-1' },
    })
    expect(plan([want], [existing]).entries.map((entry) => [entry.action, entry.existing?.id])).toEqual([
      ['unchanged', 'rec-1'],
    ])
  })

  it('仅备注不同 → update 同一槽位（值相同仍是同一条记录的另一版本）', () => {
    const existing = current('rec-1', { note: '人工记录' })
    const want = desired({ record: { type: 'CNAME', value: 'target.edgeone.net', note: 'edgeone:domain-1' } })
    expect(plan([want], [existing]).entries.map((entry) => [entry.action, entry.existing?.id])).toEqual([
      ['update', 'rec-1'],
    ])
  })

  it('域名型记录仅尾点差异 → 视为同值 unchanged', () => {
    const want = desired({ record: { type: 'CNAME', value: 'target.edgeone.net.' } })
    expect(plan([want], [current('rec-1')]).entries.map((entry) => entry.action)).toEqual(['unchanged'])
  })

  it('同一槽位多条候选：优先命中值相同的记录，且只认领一条', () => {
    const entries = plan([desired()], [current('rec-old', { value: 'old.edgeone.net' }), current('rec-exact')]).entries
    expect(entries.map((entry) => [entry.action, entry.existing?.id])).toEqual([['unchanged', 'rec-exact']])
  })

  it('FQDN 与 zone 相同时身份按 @ 归一；不同主机记录名不复用槽位', () => {
    const apex = plan([desired({ fqdn: 'example.com' })], [current('rec-apex', { name: '@' })])
    expect(apex.entries.map((entry) => entry.action)).toEqual(['unchanged'])

    const otherName = plan([desired()], [current('rec-other', { name: 'a.other.com' })])
    expect(otherName.entries.map((entry) => entry.action)).toEqual(['create'])
  })
})
