/**
 * 主机聚组与排序：按「主机前缀 / 邮箱套件」关系归并同主机记录，不靠备注
 * （备注只参与 record-purpose 的用途推断兜底，不是分组依据）。
 *
 * 聚组规则：
 * - SaaS 写回痕迹：api / _acme-challenge.api / _cf-custom-hostname.api 剥回同一聚组键
 * - 邮箱套件（MX / SPF / DKIM / DMARC）合成「邮箱」折叠组，与根域名 A/CNAME 分开
 * - 同 hostKey ≥2 条、写回相关或同主机多线路 CNAME 才折叠（见 shouldCollapseHostGroup）
 *
 * 用途判定本身（含 SaaS 写回与邮箱类型的识别细节）见 record-purpose.ts，
 * 本模块单向依赖它：同一条判定规则不在两处复制。
 */

import {
  MAIL_KEY_PREFIX,
  emailBaseHostForRecord,
  inferRecordPurpose,
  isEmailRecord,
  purposeSortKey,
  relativeHostLabel,
  stripSaaSHostPrefix,
  type RecordLike,
} from './record-purpose'

export type { RecordLike } from './record-purpose'

/**
 * 聚组键：
 * - SaaS：api / _acme-challenge.api → api
 * - 邮箱：__mail__:@  （与根域名 A/CNAME 分开，避免和业务解析糊在一起）
 */
export function recordHostKey(record: RecordLike, zoneName = ''): string {
  const rel = relativeHostLabel(record.name, zoneName)
  const saasStripped = stripSaaSHostPrefix(rel)
  if (saasStripped !== rel) return saasStripped

  if (isEmailRecord(record, zoneName)) {
    return `${MAIL_KEY_PREFIX}${emailBaseHostForRecord(record, zoneName)}`
  }

  return rel
}

function isMailGroupKey(hostKey: string): boolean {
  return String(hostKey || '').startsWith(MAIL_KEY_PREFIX)
}

/** 组展示名 */
export function hostGroupLabel(hostKey: string, zoneName = ''): string {
  if (isMailGroupKey(hostKey)) {
    const base = hostKey.slice(MAIL_KEY_PREFIX.length) || '@'
    // 邮箱 · 100022.xyz → @100022.xyz；邮箱 · edu → @edu.100022.xyz
    if (!base || base === '@') return zoneName ? `@${zoneName}` : '@'
    if (zoneName) return `@${base}.${zoneName}`
    return `@${base}`
  }
  if (!hostKey || hostKey === '@') return zoneName || '@'
  return hostKey
}

export function compareRecordsForGroup(a: RecordLike, b: RecordLike, zoneName = ''): number {
  const ha = recordHostKey(a, zoneName)
  const hb = recordHostKey(b, zoneName)
  if (ha !== hb) return ha.localeCompare(hb, 'en')
  const pa = purposeSortKey(inferRecordPurpose(a, zoneName).purpose)
  const pb = purposeSortKey(inferRecordPurpose(b, zoneName).purpose)
  if (pa !== pb) return pa - pb
  // MX 多条按优先级
  const priA = Number((a as { priority?: unknown; mx?: unknown }).priority ?? (a as { mx?: unknown }).mx ?? 0)
  const priB = Number((b as { priority?: unknown; mx?: unknown }).priority ?? (b as { mx?: unknown }).mx ?? 0)
  if (priA !== priB && (String(a.type || '').toUpperCase() === 'MX' || String(b.type || '').toUpperCase() === 'MX')) {
    return priA - priB
  }
  const la = String(a.line || '')
  const lb = String(b.line || '')
  if (la !== lb) return la.localeCompare(lb, 'zh-CN')
  const ta = String(a.type || '')
  const tb = String(b.type || '')
  if (ta !== tb) return ta.localeCompare(tb)
  return relativeHostLabel(a.name, zoneName).localeCompare(relativeHostLabel(b.name, zoneName), 'en')
}

/**
 * 是否折叠：同 hostKey ≥2 条，且（邮箱套件 / 写回相关 / 多主机名前缀）
 */
export function shouldCollapseHostGroup(records: RecordLike[], zoneName = ''): boolean {
  if (records.length < 2) return false

  // 整组邮箱（MX/SPF/DKIM/DMARC）
  if (records.every((r) => isEmailRecord(r, zoneName))) return true

  const linked = records.filter((r) => inferRecordPurpose(r, zoneName).isLinked)
  if (linked.length >= 2) return true

  // api + _acme-challenge.api 等同 hostKey 不同相对名
  const names = new Set(records.map((r) => relativeHostLabel(r.name, zoneName)))
  if (linked.length >= 1 && names.size >= 2) return true

  // 同主机多线路 CNAME
  const cnames = records.filter((r) => String(r.type || '').toUpperCase() === 'CNAME')
  return cnames.length >= 2
}
