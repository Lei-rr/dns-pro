/**
 * 解析列表聚组：按「主机前缀 / 邮箱套件」关系，不靠备注。
 *
 * SaaS 写回：
 * - api + 默认 CNAME  → 默认回源
 * - api + 境内 CNAME  → 优选域名
 * - _acme-challenge.api → DCV委派
 * - _cf-custom-hostname.api → 所有权验证
 *
 * 邮箱（Cloudflare / DNSPod 等前缀类似）：
 * - @ MX / SPF
 * - selector._domainkey / cf2024-1._domainkey
 * - _dmarc
 * → 合成「邮箱」折叠组
 */

export type SaasRemarkPurpose =
  | 'origin'
  | 'preferred'
  | 'dcv'
  | 'ownership'
  | 'edgeone'
  | 'mail_mx'
  | 'mail_spf'
  | 'mail_dkim'
  | 'mail_dmarc'
  | 'other'
  | 'none'

export type ParsedSaasRemark = {
  purpose: SaasRemarkPurpose
  purposeLabel: string
  fqdn: string
  raw: string
  isLinked: boolean
}

const PURPOSE_ORDER: Record<SaasRemarkPurpose, number> = {
  origin: 0,
  preferred: 1,
  dcv: 2,
  ownership: 3,
  edgeone: 4,
  mail_mx: 5,
  mail_spf: 6,
  mail_dkim: 7,
  mail_dmarc: 8,
  other: 9,
  none: 10,
}

/** 组头徽章固定顺序 */
export const PURPOSE_LABEL_ORDER = [
  '默认回源',
  '优选域名',
  'DCV委派',
  '所有权验证',
  'MX',
  'SPF',
  'DKIM',
  'DMARC',
] as const

const ACME_PREFIX = '_acme-challenge.'
const CF_OWNERSHIP_PREFIX = '_cf-custom-hostname.'
const MAIL_KEY_PREFIX = '__mail__:'

type RecordLike = {
  name?: string | null
  type?: string | null
  line?: string | null
  value?: string | null
  content?: string | null
  remark?: string | null
  comment?: string | null
  proxied?: boolean | null
}

/** 相对 zone 的主机标签：api.example.com → api；@ → @ */
export function relativeHostLabel(name?: string | null, zoneName = ''): string {
  let n = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  const zone = String(zoneName || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  if (!n || n === '@' || n === zone) return '@'
  if (zone && (n === zone || n.endsWith(`.${zone}`))) {
    n = n.slice(0, n.length - zone.length - 1)
    if (!n) return '@'
  }
  return n
}

function recordValue(record: RecordLike): string {
  return String(record.value || record.content || '').trim()
}

const ALIYUN_MAIL_AUX_HOSTS = new Set(['imap', 'mail', 'pop3', 'smtp'])

/** 阿里企业邮箱辅助 CNAME：归入根域名邮箱套件，而不是各自形成主机组。 */
function isAliyunMailAuxRecord(record: RecordLike, zoneName = ''): boolean {
  if (String(record.type || '').toUpperCase() !== 'CNAME') return false
  const rel = relativeHostLabel(record.name, zoneName)
  if (!ALIYUN_MAIL_AUX_HOSTS.has(rel)) return false
  const target = recordValue(record).toLowerCase().replace(/\.$/, '')
  return /^(?:imap|pop|smtp)\.qiye\.aliyun\.com$/.test(target) || target === 'qiye.aliyun.com'
}

function emailBaseHostForRecord(record: RecordLike, zoneName = ''): string {
  if (isAliyunMailAuxRecord(record, zoneName)) return '@'
  return emailBaseHost(relativeHostLabel(record.name, zoneName))
}

/**
 * 邮箱业务主机：把 DKIM / DMARC 前缀剥掉，归到对应邮箱主机。
 * cf2024-1._domainkey → @
 * s1._domainkey.mail → mail
 * _dmarc → @
 * _dmarc.mail → mail
 */
export function emailBaseHost(rel: string): string {
  const r = String(rel || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  if (!r || r === '@') return '@'

  // selector._domainkey 或 selector._domainkey.sub
  const dkim = r.match(/^(?:[^.]+)\._domainkey(?:\.(.+))?$/)
  if (dkim) return dkim[1] || '@'
  // 裸 _domainkey / _domainkey.sub
  if (r === '_domainkey') return '@'
  if (r.startsWith('_domainkey.')) return r.slice('_domainkey.'.length) || '@'

  if (r === '_dmarc') return '@'
  if (r.startsWith('_dmarc.')) return r.slice('_dmarc.'.length) || '@'

  return r
}

/** 是否邮箱相关解析（CF 邮箱路由 / DNSPod 企业邮等前缀类似） */
export function isEmailRecord(record: RecordLike, zoneName = ''): boolean {
  const type = String(record.type || '').toUpperCase()
  const rel = relativeHostLabel(record.name, zoneName)
  const val = recordValue(record)

  if (type === 'MX') return true
  if (rel.includes('_domainkey')) return true
  if (rel === '_dmarc' || rel.startsWith('_dmarc.')) return true
  if (type === 'TXT') {
    if (/^v=spf1\b/i.test(val) || /\bv=spf1\b/i.test(val)) return true
    if (/^v=dmarc1\b/i.test(val) || /\bv=DMARC1\b/i.test(val)) return true
  }
  // Cloudflare Email Routing 特征
  if (/mx\.cloudflare\.net/i.test(val) || /_spf\.mx\.cloudflare\.net/i.test(val)) return true
  // 常见第三方邮（DNSPod 侧也多见）
  if (type === 'MX' || type === 'CNAME' || type === 'TXT') {
    if (
      /qq\.com|mxbiz\d*\.qq\.com|aliyun|mxhichina|outlook\.com|protection\.outlook|google\.com|googlemail|zoho|mail\.me\.com|icloud/i.test(
        val,
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * 聚组键：
 * - SaaS：api / _acme-challenge.api → api
 * - 邮箱：__mail__:@  （与根域名 A/CNAME 分开，避免和业务解析糊在一起）
 */
export function recordHostKey(record: RecordLike, zoneName = ''): string {
  const rel = relativeHostLabel(record.name, zoneName)

  if (rel.startsWith(ACME_PREFIX)) {
    return rel.slice(ACME_PREFIX.length) || '@'
  }
  if (rel.startsWith(CF_OWNERSHIP_PREFIX)) {
    return rel.slice(CF_OWNERSHIP_PREFIX.length) || '@'
  }

  if (isEmailRecord(record, zoneName)) {
    return `${MAIL_KEY_PREFIX}${emailBaseHostForRecord(record, zoneName)}`
  }

  return rel
}

export function isMailGroupKey(hostKey: string): boolean {
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

/**
 * 推断用途：主机结构 + 线路 + 邮箱类型；备注仅兜底。
 */
export function inferRecordPurpose(record: RecordLike, zoneName = ''): ParsedSaasRemark {
  const rel = relativeHostLabel(record.name, zoneName)
  const type = String(record.type || '').toUpperCase()
  const line = String(record.line || '').trim()
  const remark = String(record.remark || record.comment || '').trim()
  const val = recordValue(record)
  const baseKey = isEmailRecord(record, zoneName)
    ? emailBaseHostForRecord(record, zoneName)
    : recordHostKey(record, zoneName).startsWith(MAIL_KEY_PREFIX)
      ? emailBaseHost(rel)
      : recordHostKey(record, zoneName).replace(MAIL_KEY_PREFIX, '')
  const fqdn =
    !baseKey || baseKey === '@'
      ? zoneName || ''
      : zoneName
        ? `${baseKey}.${zoneName}`
        : baseKey

  // —— 邮箱 ——
  if (isEmailRecord(record, zoneName)) {
    if (type === 'MX' || /mx\.cloudflare\.net/i.test(val)) {
      return { purpose: 'mail_mx', purposeLabel: 'MX', fqdn, raw: remark, isLinked: true }
    }
    if (rel.includes('_domainkey')) {
      return { purpose: 'mail_dkim', purposeLabel: 'DKIM', fqdn, raw: remark, isLinked: true }
    }
    if (rel === '_dmarc' || rel.startsWith('_dmarc.') || /\bv=DMARC1\b/i.test(val)) {
      return { purpose: 'mail_dmarc', purposeLabel: 'DMARC', fqdn, raw: remark, isLinked: true }
    }
    if (/\bv=spf1\b/i.test(val) || /_spf\.mx\.cloudflare\.net/i.test(val)) {
      return { purpose: 'mail_spf', purposeLabel: 'SPF', fqdn, raw: remark, isLinked: true }
    }
    return { purpose: 'other', purposeLabel: '邮箱', fqdn, raw: remark, isLinked: true }
  }

  // DCV
  if (rel.startsWith(ACME_PREFIX) && (type === 'CNAME' || type === 'TXT' || type === '')) {
    return { purpose: 'dcv', purposeLabel: 'DCV委派', fqdn, raw: remark, isLinked: true }
  }

  // 所有权
  if (rel.startsWith(CF_OWNERSHIP_PREFIX)) {
    return { purpose: 'ownership', purposeLabel: '所有权验证', fqdn, raw: remark, isLinked: true }
  }

  // 同主机 CNAME：境内 → 优选；默认 → 回源
  if (type === 'CNAME' && !rel.startsWith('_')) {
    if (line === '境内' || line === '电信' || line === '联通' || line === '移动') {
      return { purpose: 'preferred', purposeLabel: '优选域名', fqdn, raw: remark, isLinked: true }
    }
    if (!line || line === '默认' || line === 'default' || line === 'Default') {
      if (/^优选域名/.test(remark.split(/[丨|｜]/)[0] || '')) {
        return { purpose: 'preferred', purposeLabel: '优选域名', fqdn, raw: remark, isLinked: true }
      }
      return { purpose: 'origin', purposeLabel: '默认回源', fqdn, raw: remark, isLinked: true }
    }
  }

  // 备注兜底
  if (remark) {
    const head = remark.split(/[丨|｜]/)[0]?.trim() || ''
    if (/^默认回源|^业务接入/.test(head)) {
      return { purpose: 'origin', purposeLabel: '默认回源', fqdn, raw: remark, isLinked: true }
    }
    if (/^优选域名/.test(head)) {
      return { purpose: 'preferred', purposeLabel: '优选域名', fqdn, raw: remark, isLinked: true }
    }
    if (/^DCV/.test(head)) {
      return { purpose: 'dcv', purposeLabel: 'DCV委派', fqdn, raw: remark, isLinked: true }
    }
    if (/^所有权/.test(head)) {
      return { purpose: 'ownership', purposeLabel: '所有权验证', fqdn, raw: remark, isLinked: true }
    }
    if (/^EdgeOne/.test(head)) {
      return { purpose: 'edgeone', purposeLabel: 'EdgeOne', fqdn, raw: remark, isLinked: true }
    }
  }

  return { purpose: 'none', purposeLabel: '', fqdn: '', raw: remark, isLinked: false }
}

export function purposeSortKey(purpose: SaasRemarkPurpose): number {
  return PURPOSE_ORDER[purpose] ?? 9
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

/** 组头用途徽章：固定顺序，只显示本组有的 */
export function orderedPurposeLabels(records: RecordLike[], zoneName = ''): string[] {
  const present = new Set<string>()
  const extras: string[] = []
  for (const r of records) {
    const v = inferRecordPurpose(r, zoneName)
    if (!v.isLinked || !v.purposeLabel) continue
    if ((PURPOSE_LABEL_ORDER as readonly string[]).includes(v.purposeLabel)) {
      present.add(v.purposeLabel)
    } else if (!extras.includes(v.purposeLabel)) {
      extras.push(v.purposeLabel)
    }
  }
  return [...PURPOSE_LABEL_ORDER.filter((l) => present.has(l)), ...extras]
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
