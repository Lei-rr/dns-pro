/**
 * planSync 纯函数探针：create / update / unchanged / delete 四类动作与归属保护。
 * 无网络、无存储，直接断言计划结果。
 */
import assert from 'node:assert/strict'
import { planSync, type DesiredRecord } from '../server/workflows/derived-records/sync-plan.js'
import type { DnsRecordRef } from '../server/core/contracts/dns-record.port.js'

const zone = 'example.com'
const base = { providerType: 'dnspod', providerId: 'p1', zone }

const want = (value: string, note = 'EdgeOne 加速丨a.example.com'): DesiredRecord => ({
  purpose: 'edgeone_cname',
  fqdn: 'a.example.com',
  owner: 'edgeone',
  refId: 'a.example.com',
  record: { type: 'CNAME', value, line: '默认', note, ttl: 600 },
})

function ref(id: string, value: string, note = 'EdgeOne 加速丨a.example.com'): DnsRecordRef {
  return { id, value: { type: 'CNAME', name: 'a', value, line: '默认', lineId: '', note, ttl: 600 } }
}

// 1) 现状为空 → create
{
  const plan = planSync({ ...base, desired: [want('target.example.net')], current: [] })
  assert.deepEqual(
    plan.entries.map((e) => e.action),
    ['create'],
    `空现状应创建：${JSON.stringify(plan.entries)}`
  )
}

// 2) 值/备注/TTL 全同 → unchanged，且不重复创建
{
  const plan = planSync({ ...base, desired: [want('target.example.net')], current: [ref('1', 'target.example.net')] })
  assert.deepEqual(
    plan.entries.map((e) => [e.action, e.existing?.id]),
    [['unchanged', '1']],
    '同值应为 unchanged'
  )
}

// 3) 值不同 → update 同一槽位（复用 record id）
{
  const plan = planSync({ ...base, desired: [want('new.example.net')], current: [ref('7', 'old.example.net')] })
  assert.deepEqual(
    plan.entries.map((e) => [e.action, e.existing?.id]),
    [['update', '7']],
    '值变化应 update'
  )
}

// 4) 备注不同 → update（不是 unchanged）
{
  const plan = planSync({
    ...base,
    desired: [want('target.example.net')],
    current: [ref('2', 'target.example.net', '人工记录')],
  })
  assert.deepEqual(
    plan.entries.map((e) => e.action),
    ['update'],
    '备注不同应 update'
  )
}

// 5) 顶层值带尾点差异 → 视为同值
{
  const plan = planSync({
    ...base,
    desired: [want('target.example.net.')],
    current: [ref('3', 'target.example.net')],
  })
  assert.deepEqual(
    plan.entries.map((e) => e.action),
    ['unchanged'],
    '域名型记录尾点差异应视为同值'
  )
}

// 6) keep=false 且备注可证明归属 → delete
{
  const plan = planSync({ ...base, desired: [{ ...want(''), keep: false }], current: [ref('9', 'old.example.net')] })
  assert.deepEqual(
    plan.entries.map((e) => [e.action, e.existing?.id]),
    [['delete', '9']],
    '按备注应能清理'
  )
}

// 7) keep=false 但归属不明 → 一条都不产生（保护人工记录）
{
  const current: DnsRecordRef[] = [
    { id: '5', value: { type: 'CNAME', name: 'a', value: 'someone-else.example.net', line: '默认', note: '人工记录' } },
  ]
  const plan = planSync({ ...base, desired: [{ ...want('', ''), keep: false }], current })
  assert.deepEqual(plan.entries, [], `归属不明不得清理：${JSON.stringify(plan.entries)}`)
}

// 8) 同一槽位多条候选：值相同者优先，且不重复认领同一条
{
  const current = [ref('4', 'old.example.net'), ref('8', 'target.example.net')]
  const plan = planSync({ ...base, desired: [want('target.example.net')], current })
  assert.deepEqual(
    plan.entries.map((e) => [e.action, e.existing?.id]),
    [['unchanged', '8']],
    '应命中值相同的记录'
  )
}

// 9) FQDN 与 zone 相同 → 身份按 @ 归一，不同 zone 后缀不会误配
{
  const other = ref('6', 'target.example.net')
  other.value.name = 'a.other.com'
  const plan = planSync({ ...base, desired: [want('target.example.net')], current: [other] })
  assert.deepEqual(
    plan.entries.map((e) => e.action),
    ['create'],
    '不同主机名不得复用槽位'
  )
}

console.log('sync-plan-probe=ok actions=create,update,unchanged,delete guards=ownership,line,trailing-dot')
