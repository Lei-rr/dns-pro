/**
 * D1 端口：DNS 记录读写。
 * 新增服务商只实现本端口，不新增 workflow。
 * 值模型厂商无关：name 为相对主机记录（'@' 或 'www'），各适配器负责与厂商字段互转。
 */
import { ApiError } from '../http/api-error.js'

/**
 * DNS 服务商类型：providerType / 端口表的判别键只此一处。
 * 注意与 SaaS 同步目标的词表区分（sync_target 用 'cloudflare_dns'，见 saas-sync-config.port），
 * 类型闭合后把 'cloudflare_dns' 写进 provider_type 会直接编译失败。
 */
export type DnsProviderType = 'dnspod' | 'cloudflare'

/** 运行时收窄：任务 payload 与 JSON 数据里的厂商取值必须先过守卫，不能靠 string 直接下标 */
export function isDnsProviderType(value: unknown): value is DnsProviderType {
  return value === 'dnspod' || value === 'cloudflare'
}

/** 判别键穷尽自检：switch 覆盖全部成员后 default 分支才可传入 never；未知值只可能来自绕过类型的运行时数据 */
export function unsupportedDnsProvider(value: never): never {
  throw new ApiError('dns_provider_unsupported', `Unsupported DNS provider: ${String(value)}`, 422)
}

/** 记录启停状态：写入侧只认这两个值，避免「要求停用」被静默写成启用 */
export type DnsRecordStatus = 'ENABLE' | 'DISABLE'

export interface DnsRecordValue {
  type: string
  name: string
  value: string
  ttl?: number
  line?: string
  lineId?: string
  priority?: number
  note?: string
  proxied?: boolean
  status?: DnsRecordStatus
  weight?: number
}

/** 端口返回的记录：厂商 ID + 归一化值 */
export interface DnsRecordRef {
  id: string
  value: DnsRecordValue
}

/** 查询条件：name 必填；type 省略时返回该主机名下的全部类型（冲突清理需要） */
export type DnsRecordProbe = Pick<DnsRecordValue, 'name'> & Partial<DnsRecordValue>

export interface DnsRecordPort {
  /** 精确查询同名（同类型/同线路）记录，返回值已归一化 */
  find(providerId: string, zone: string, probe: DnsRecordProbe): Promise<DnsRecordRef[]>
  create(providerId: string, zone: string, value: DnsRecordValue): Promise<DnsRecordRef>
  update(providerId: string, zone: string, recordId: string, value: DnsRecordValue): Promise<DnsRecordRef>
  remove(providerId: string, zone: string, recordId: string): Promise<void>
}

const text = (value: unknown) => String(value ?? '').trim()

/** 上游返回值 → 启停状态：只认 ENABLE / DISABLE（忽略大小写），未知返回 undefined（不参与判等） */
export function dnsRecordStatusOf(value: unknown): DnsRecordStatus | undefined {
  const raw = text(value).toUpperCase()
  return raw === 'ENABLE' || raw === 'DISABLE' ? raw : undefined
}

/**
 * 解析写入用的启停状态：缺失 / 空串表示「不改动该字段」，未知值显式 422。
 * 归一到 ENABLE 会让「要求停用」静默变成启用，所以宁可失败也不猜。
 */
export function parseDnsRecordStatus(value: unknown): DnsRecordStatus | undefined {
  if (value === undefined || value === null) return undefined
  const raw = text(value)
  if (raw === '') return undefined
  const status = dnsRecordStatusOf(raw)
  if (status === undefined) {
    throw new ApiError('dns_record_status_invalid', `Unsupported DNS record status: ${raw}`, 422, { status: raw })
  }
  return status
}

/** 域名类记录的值比较忽略大小写与尾点 */
function normalizeDnsValue(type: string, value: unknown): string {
  const upper = type.toUpperCase()
  return ['CNAME', 'NS', 'PTR', 'MX'].includes(upper) ? text(value).toLowerCase().replace(/\.+$/, '') : text(value)
}

/** 值相等判定（只比较记录值本身，用于识别"同一条记录的另一个版本"） */
export function sameDnsValue(actual: DnsRecordValue, expected: DnsRecordValue): boolean {
  const type = text(expected.type).toUpperCase()
  return normalizeDnsValue(type, actual.value) === normalizeDnsValue(type, expected.value)
}

/** FQDN → 相对主机记录（与 zone 相同时返回 '@'） */
export function relativeRecordName(fqdn: string, zone: string): string {
  const host = text(fqdn).toLowerCase().replace(/\.+$/, '')
  const base = text(zone).toLowerCase().replace(/\.+$/, '')
  if (base === '' || host === base) return '@'
  const suffix = `.${base}`
  return host.endsWith(suffix) ? host.slice(0, -suffix.length) : host
}

/** 幂等重放判定：创建前用它确认记录是否已存在（厂商字段差异不参与比较） */
export function dnsRecordMatches(actual: DnsRecordValue, expected: DnsRecordValue): boolean {
  const type = text(expected.type).toUpperCase()
  const sameNumber = (a?: number, e?: number) => e === undefined || Number(a) === Number(e)
  const sameText = (a?: string, e?: string) => e === undefined || e === '' || text(a) === text(e)
  const lineMatches = expected.lineId
    ? text(actual.lineId) === text(expected.lineId)
    : sameText(actual.line, expected.line)
  return (
    text(actual.name).toLowerCase() === text(expected.name).toLowerCase() &&
    text(actual.type).toUpperCase() === type &&
    normalizeDnsValue(type, actual.value) === normalizeDnsValue(type, expected.value) &&
    lineMatches &&
    sameNumber(actual.ttl, expected.ttl) &&
    sameNumber(actual.priority, expected.priority) &&
    sameText(actual.note, expected.note) &&
    sameText(actual.status, expected.status) &&
    sameNumber(actual.weight, expected.weight) &&
    (expected.proxied === undefined || Boolean(actual.proxied) === Boolean(expected.proxied))
  )
}
