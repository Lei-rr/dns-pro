import type {
  DnsProviderType,
  DnsRecordProbe,
  DnsRecordRef,
  DnsRecordValue,
} from '../../core/contracts/dns-record.port.js'
import { dnsRecordMatches, relativeRecordName, sameDnsValue } from '../../core/contracts/dns-record.port.js'
import type { DerivedOwner } from '../../core/contracts/ownership.port.js'

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
  /** D4 归属声明：本记录由哪条产品线派生 */
  owner: DerivedOwner
  /**
   * 派生来源标识（主机名 ID / 加速域名 / 隧道 ID）。
   * 资源已删除后的清理（关系已消失）必须携带，否则同一条目被视为无主记录而拒绝自动写入。
   */
  refId?: string
}

export type SyncAction = 'create' | 'update' | 'delete' | 'unchanged'

export interface SyncPlanEntry {
  purpose: string
  action: SyncAction
  fqdn: string
  record: Omit<DnsRecordValue, 'name'>
  /** D4 归属声明：校验写入/删除目标是否由本产品线派生 */
  owner: DerivedOwner
  refId: string
  /** 命中的现有记录 */
  existing?: DnsRecordRef
}

export interface SyncPlan {
  providerType: DnsProviderType
  providerId: string
  zone: string
  entries: SyncPlanEntry[]
}

/**
 * 线路身份两侧必须对称：厂商返回的现状记录总带 lineId（DNSPod 默认线路为 '0'），
 * 而期望记录通常只声明可读的 line，若优先取 lineId 会让同一槽位被判成两个身份，
 * 结果是现状永远匹配不上、每次同步都重复写入。
 */
function recordLine(value: DnsRecordValue): string {
  return String(value.line ?? '').trim() || String(value.lineId ?? '').trim()
}

/** 记录身份：类型 + 主机名 + 线路（同身份视为同一槽位；planner 与对账引擎共用，避免第二份判据） */
export function recordIdentity(value: DnsRecordValue): string {
  const name = String(value.name ?? '')
    .toLowerCase()
    .replace(/\.+$/, '')
  return [String(value.type).toUpperCase(), name, recordLine(value)].join('|')
}

/**
 * 端口查询条件：FQDN + 类型 + 线路 → 相对主机记录 probe（写入与只读检测共用同一判据）。
 * 线路必须随期望记录下推，否则多线路产品线（如「境内」优选）拿不到现状而反复重写。
 */
export function recordProbe(
  fqdn: string,
  zone: string,
  record: Pick<DnsRecordValue, 'type' | 'line' | 'lineId'>
): DnsRecordProbe {
  const line = String(record.line ?? '').trim()
  const lineId = String(record.lineId ?? '').trim()
  return {
    name: relativeRecordName(fqdn, zone),
    type: String(record.type || 'A').toUpperCase(),
    ...(line ? { line } : {}),
    ...(lineId ? { lineId } : {}),
  }
}

/**
 * 期望态 + 现状 → 计划（纯函数，无 IO，可单测）。
 * 清理只认「能证明归属」的记录：值相同，或备注与声明一致；归属不明一律不动。
 */
export function planSync(input: {
  providerType: DnsProviderType
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
        owner: want.owner,
        refId: String(want.refId ?? ''),
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
