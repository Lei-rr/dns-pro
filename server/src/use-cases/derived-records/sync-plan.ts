import type { DnsRecordRef, DnsRecordValue } from '../../kernel/contracts/dns-record.port.js'
import { dnsRecordMatches, relativeRecordName, sameDnsValue } from '../../kernel/contracts/dns-record.port.js'

/** 产品线声明的期望记录：DNS 记录是上层资源的派生投影 */
export interface DesiredRecord {
  /** 用途标记（写入备注、判定归属），如 edgeone_cname / saas_origin */
  purpose: string
  /** 目标 FQDN */
  fqdn: string
  /** 期望记录值（主机名由 fqdn 推导） */
  record: Omit<DnsRecordValue, 'name'>
  /** false 表示期望该记录不存在（清理） */
  keep?: boolean
}

export type SyncAction = 'create' | 'update' | 'delete' | 'unchanged'

export interface SyncPlanEntry {
  purpose: string
  action: SyncAction
  fqdn: string
  record: Omit<DnsRecordValue, 'name'>
  /** 命中的现有记录 */
  existing?: DnsRecordRef
}

export interface SyncPlan {
  providerType: string
  providerId: string
  zone: string
  entries: SyncPlanEntry[]
}

/** 记录身份：类型 + 主机名 + 线路（同身份视为同一槽位） */
function recordIdentity(value: DnsRecordValue): string {
  const name = String(value.name ?? '')
    .toLowerCase()
    .replace(/\.+$/, '')
  return [String(value.type).toUpperCase(), name, value.lineId || value.line || ''].join('|')
}

/**
 * 期望态 + 现状 → 计划（纯函数，无 IO，可单测）。
 * 清理只认「能证明归属」的记录：值相同，或备注与声明一致；归属不明一律不动。
 */
export function planSync(input: {
  providerType: string
  providerId: string
  zone: string
  desired: DesiredRecord[]
  current: DnsRecordRef[]
}): SyncPlan {
  const claimed = new Set<string>()
  const entries: SyncPlanEntry[] = []
  for (const want of input.desired) {
    // 端口层的 name 是相对主机记录；期望记录声明的是 FQDN，比较前先归一
    const wanted: DnsRecordValue = { ...want.record, name: relativeRecordName(want.fqdn, input.zone) }
    const identity = recordIdentity(wanted)
    const slots = input.current.filter((ref) => !claimed.has(ref.id) && recordIdentity(ref.value) === identity)
    const push = (action: SyncAction, existing?: DnsRecordRef) =>
      entries.push({
        purpose: want.purpose,
        action,
        fqdn: want.fqdn,
        record: want.record,
        ...(existing ? { existing } : {}),
      })

    if (want.keep === false) {
      const note = wanted.note ?? ''
      const victim = slots.find((ref) => sameDnsValue(ref.value, wanted) || (note !== '' && ref.value.note === note))
      if (victim) {
        claimed.add(victim.id)
        push('delete', victim)
      }
      continue
    }

    const exact = slots.find((ref) => dnsRecordMatches(ref.value, wanted))
    if (exact) {
      claimed.add(exact.id)
      push('unchanged', exact)
      continue
    }
    // 同槽位已有记录但值/备注/TTL 不同 → 更新；值相同的优先作为目标
    const target = slots.find((ref) => sameDnsValue(ref.value, wanted)) ?? slots[0]
    if (target) {
      claimed.add(target.id)
      push('update', target)
      continue
    }
    push('create')
  }
  return { providerType: input.providerType, providerId: input.providerId, zone: input.zone, entries }
}
