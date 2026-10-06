/**
 * 解析记录用途推断：把一条记录判定为 默认回源 / 优选域名 / DCV委派 / 所有权验证 /
 * 邮箱套件（MX / SPF / DKIM / DMARC）/ 其他 / 无 之一。备注只在最后兜底
 * （见 inferRecordPurpose），不是判定主依据。
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
 * → 判定为 mail_mx / mail_spf / mail_dkim / mail_dmarc
 *
 * 聚组层（record-group）单向依赖本模块：主机标签解析、邮箱识别、SaaS 写回前缀剥除与
 * 用途排序权重都由此导出供其复用；本模块不反向 import record-group，避免两个模块成环。
 */

type RecordPurpose =
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

type RecordPurposeInfo = {
  purpose: RecordPurpose
  purposeLabel: string
  fqdn: string
  raw: string
  isLinked: boolean
}

const PURPOSE_ORDER: Record<RecordPurpose, number> = {
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

const ACME_PREFIX = '_acme-challenge.'
const CF_OWNERSHIP_PREFIX = '_cf-custom-hostname.'
export const MAIL_KEY_PREFIX = '__mail__:'

export type RecordLike = {
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
  if (zone && n.endsWith(`.${zone}`)) {
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

export function emailBaseHostForRecord(record: RecordLike, zoneName = ''): string {
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
function emailBaseHost(rel: string): string {
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
  if (type === 'CNAME' || type === 'TXT') {
    if (
      /qq\.com|aliyun|mxhichina|outlook\.com|protection\.outlook|google\.com|googlemail|zoho|mail\.me\.com|icloud/i.test(
        val
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * 剥除 SaaS 写回痕迹的主机前缀：_acme-challenge.api → api、_cf-custom-hostname.api → api；
 * 未命中时原样返回。用途判定（DCV / 所有权）与聚组键共用这条规则，只保留一处实现。
 */
export function stripSaaSHostPrefix(rel: string): string {
  if (rel.startsWith(ACME_PREFIX)) return rel.slice(ACME_PREFIX.length) || '@'
  if (rel.startsWith(CF_OWNERSHIP_PREFIX)) return rel.slice(CF_OWNERSHIP_PREFIX.length) || '@'
  return rel
}

/**
 * 推断用途：主机结构 + 线路 + 邮箱类型；备注仅兜底。
 * 导出给组头徽章（record-display）复用同一份推断，避免展示层另立一套规则。
 */
export function inferRecordPurpose(record: RecordLike, zoneName = ''): RecordPurposeInfo {
  const rel = relativeHostLabel(record.name, zoneName)
  const type = String(record.type || '').toUpperCase()
  const line = String(record.line || '').trim()
  const remark = String(record.remark || record.comment || '').trim()
  const val = recordValue(record)
  // 非邮箱记录不会带邮箱前缀，无需再判断；非邮箱分支即聚组键在非邮箱情形下的取值
  // （剥 SaaS 前缀），复用同一函数而不是反向 import record-group。
  const baseKey = isEmailRecord(record, zoneName) ? emailBaseHostForRecord(record, zoneName) : stripSaaSHostPrefix(rel)
  const fqdn = !baseKey || baseKey === '@' ? zoneName || '' : zoneName ? `${baseKey}.${zoneName}` : baseKey

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

/** 用途排序权重：聚组层按它排组内顺序（原文件里就服务 compareRecordsForGroup）。 */
export function purposeSortKey(purpose: RecordPurpose): number {
  return PURPOSE_ORDER[purpose]
}
