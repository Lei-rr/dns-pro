/**
 * SaaS 期望记录构造（§4.2 planner 的记录侧）。
 *
 * 单一数据源：写入路径（SaaS 同步适配器）与对账检测共用本文件的记录构造与清理配方，
 * 避免"同步"与"对账"两套判据漂移。对外仍经 saas.planner 再导出，调用方不感知。
 */
import { ApiError } from '../../../core/http/api-error.js'
import type { DnsRecordValue } from '../../../core/contracts/dns-record.port.js'
import { DNSPOD_DEFAULT_LINE } from '../../../modules/dnspod/dns-pod-record.service.js'
import type { CloudflareCustomHostname } from '../../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import { effectivePreferredDomain, isHostnameActive } from '../../../modules/cloudflare/saas/saas-hostname-rules.js'
import { recordIdentity, type DesiredRecord } from '../sync-plan.js'

/** SaaS 同步目标厂商：DNSPod 与 Cloudflare DNS */ export type SaaSSyncProviderType = 'dnspod' | 'cloudflare'

/** 记录归属的服务商类型 + 写入目标（跨阶段使用，因此自带 provider 与 zone） */
export interface SaaSSyncRecord extends DesiredRecord {
  provider_type: SaaSSyncProviderType
  provider_id: string
  zone: string
}

export interface SyncCollectedRecords {
  hostname_fqdn: string
  records: SaaSSyncRecord[]
}

const PURPOSE_LABELS: Record<string, string> = {
  preferred_cname: '优选域名',
  ownership_verification: '所有权验证',
  dcv_delegation: 'DCV 委派',
}

export const ownershipTxtName = (fqdn: string) => `_cf-custom-hostname.${fqdn}`

/** 业务 CNAME 的备注标签：DNSPod 与 Cloudflare 各自沿用历史值，避免已有记录被判定为变更 */
export const DNSPOD_ORIGIN_LABEL = '默认回源'
export const CLOUDFLARE_ORIGIN_LABEL = '业务接入'

/** DNSPod 分线路：默认线路指向业务回源，境内线路指向优选域名 */
export const DNSPOD_PREFERRED_LINE = '境内'

/** 同步记录 TTL：DNSPod 沿用历史默认值；Cloudflare 1 表示自动 */
const DNSPOD_RECORD_TTL = 600
const CLOUDFLARE_RECORD_TTL = 1

const acmeChallengeName = (fqdn: string) => `_acme-challenge.${fqdn}`

/**
 * 记录备注：用途丨主机名。
 * 业务 CNAME 标签沿用历史值（DNSPod「默认回源」/ Cloudflare「业务接入」），避免已有记录因备注变化被重复更新。
 */
export function syncRemark(purpose: string, fqdn: string, originLabel: string): string {
  const label = purpose === 'origin_cname' ? originLabel : PURPOSE_LABELS[purpose]
  return `${label ?? '自定义主机名'}丨${fqdn}`
}

export function requireFqdn(hostname: CloudflareCustomHostname): string {
  if (!hostname.hostname) throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)
  return hostname.hostname
}

export function requireBusinessTarget(target: string): string {
  if (target.trim() === '')
    throw new ApiError('saas_business_target_missing', 'No business CNAME target available', 422)
  return target
}

/** DCV 委派 CNAME：优先使用 Cloudflare 返回的记录，否则用 UUID 推导 */
function dcvDelegationRecords(hostname: CloudflareCustomHostname): Array<{ name: string; value: string }> {
  const ssl = hostname.ssl ?? {}
  const explicit = (ssl.dcv_delegation_records ?? [])
    .map((record) => ({ name: String(record.cname ?? ''), value: String(record.cname_target ?? '') }))
    .filter((record) => record.name !== '' && record.value !== '')
  if (explicit.length > 0) return explicit
  const uuid = String(ssl.dcv_delegation_uuid ?? '').trim()
  const fqdn = hostname.hostname
  return fqdn && uuid ? [{ name: acmeChallengeName(fqdn), value: `${fqdn}.${uuid}.dcv.cloudflare.com` }] : []
}

/** 所有权验证 TXT；forceName 时即使无值也输出（用于按名称清理） */
function ownershipRecord(hostname: CloudflareCustomHostname, forceName = false) {
  const ownership = hostname.ownership_verification
  if (ownership?.name && ownership.value) return { name: ownership.name, value: ownership.value }
  return forceName && hostname.hostname ? { name: ownershipTxtName(hostname.hostname), value: '' } : null
}

/** 期望记录构造器：把"类型/名称/值/用途/备注/目标"收敛到一处 */
export function desiredRecord(input: {
  fqdn: string
  purpose: string
  record: Omit<DnsRecordValue, 'name'>
  provider_type: SaaSSyncProviderType
  provider_id: string
  zone: string
  /** 派生来源标识（主机名 ID）；缺省回退到 FQDN */
  refId?: string
}): SaaSSyncRecord {
  return {
    purpose: input.purpose,
    fqdn: input.fqdn,
    record: input.record,
    owner: 'saas',
    refId: input.refId ?? '',
    provider_type: input.provider_type,
    provider_id: input.provider_id,
    zone: input.zone,
  }
}

/** 清理配方：记录归属已由备注/值证明，keep=false 让写入口只删"自己的"记录 */
export const cleanupDesired = (record: SaaSSyncRecord): SaaSSyncRecord => ({ ...record, keep: false })

/** 记录稳定身份：类型|全名|线路（值与备注变化视为同一记录原地更新；判据来自 sync-plan，与对账检测同口径） */
export const syncRecordIdentity = (record: SaaSSyncRecord): string =>
  recordIdentity({ ...record.record, name: record.fqdn })

/** 统计删除条数（写入口回执） */
export const countDeleted = (results: Array<{ status?: unknown }>) =>
  results.filter((result) => result.status === 'deleted').length

/** Cloudflare 主机名已删除时的清理配方（值为空，按名称+类型+备注匹配） */
export function cloudflareDnsCleanupRecipe(fqdn: string, providerId: string, zoneName: string): SaaSSyncRecord[] {
  const target = { provider_type: 'cloudflare' as const, provider_id: providerId, zone: zoneName }
  const record = (type: string, name: string, purpose: string): SaaSSyncRecord =>
    desiredRecord({
      ...target,
      fqdn: name,
      purpose,
      refId: fqdn,
      record: { type, value: '', note: syncRemark(purpose, fqdn, CLOUDFLARE_ORIGIN_LABEL) },
    })
  return [
    record('CNAME', fqdn, 'origin_cname'),
    record('CNAME', acmeChallengeName(fqdn), 'dcv_delegation'),
    record('TXT', ownershipTxtName(fqdn), 'ownership_verification'),
  ]
}

/** DNSPod 主机名已删除时的清理配方（值为空，按名称+类型+线路+备注匹配） */
export function dnspodSaaSCleanupRecipe(
  fqdn: string,
  dnspodProviderId: string,
  dnspodZone: string,
  lines: { default: string; preferred: string }
): SaaSSyncRecord[] {
  const target = { provider_type: 'dnspod' as const, provider_id: dnspodProviderId, zone: dnspodZone }
  const record = (type: string, name: string, purpose: string, line = lines.default): SaaSSyncRecord =>
    desiredRecord({
      ...target,
      fqdn: name,
      purpose,
      refId: fqdn,
      record: { type, value: '', line, note: syncRemark(purpose, fqdn, DNSPOD_ORIGIN_LABEL) },
    })
  return [
    record('CNAME', fqdn, 'origin_cname'),
    record('CNAME', fqdn, 'preferred_cname', lines.preferred),
    record('CNAME', acmeChallengeName(fqdn), 'dcv_delegation'),
    record('TXT', ownershipTxtName(fqdn), 'ownership_verification'),
  ]
}

/**
 * 主机名应有的全部 DNS 记录（写入路径与对账检测共用）。
 * includeAll：用于清理快照/检测，强制包含所有权 TXT（即使已激活）。
 */
export function saasDesiredRecords(input: {
  hostname: CloudflareCustomHostname
  providerType: SaaSSyncProviderType
  providerId: string
  zone: string
  /** 站点回源（业务 CNAME 的兜底目标） */
  origin: string
  includeAll?: boolean
}): SaaSSyncRecord[] {
  const fqdn = input.hostname.hostname
  if (!fqdn) return []
  const dnspod = input.providerType === 'dnspod'
  const refId = String(input.hostname.id ?? '').trim() || fqdn
  const record = (type: string, name: string, value: string, purpose: string, line?: string) =>
    desiredRecord({
      fqdn: name,
      purpose,
      refId,
      record: {
        type,
        value,
        ...(dnspod ? { line: line ?? DNSPOD_DEFAULT_LINE } : {}),
        ttl: dnspod ? DNSPOD_RECORD_TTL : CLOUDFLARE_RECORD_TTL,
        note: syncRemark(purpose, fqdn, dnspod ? DNSPOD_ORIGIN_LABEL : CLOUDFLARE_ORIGIN_LABEL),
      },
      provider_type: input.providerType,
      provider_id: input.providerId,
      zone: input.zone,
    })

  const records: SaaSSyncRecord[] = []
  const preferred = effectivePreferredDomain(input.hostname)
  if (dnspod) {
    if (input.origin) records.push(record('CNAME', fqdn, input.origin, 'origin_cname'))
    if (input.hostname.auto_preferred && preferred) {
      records.push(record('CNAME', fqdn, preferred, 'preferred_cname', DNSPOD_PREFERRED_LINE))
    }
  } else {
    // Cloudflare 无线路拆分：有优选用优选，否则用回源
    const business = preferred || input.origin
    if (business) records.push(record('CNAME', fqdn, business, 'origin_cname'))
  }
  for (const dcv of dcvDelegationRecords(input.hostname)) {
    records.push(record('CNAME', dcv.name, dcv.value, 'dcv_delegation'))
  }

  // 已激活的主机名不再写入所有权 TXT（DNSPod 快照模式强制包含，Cloudflare 仅快照包含）
  const includeOwnership = dnspod
    ? Boolean(input.includeAll) || !isHostnameActive(input.hostname)
    : Boolean(input.includeAll)
  if (includeOwnership) {
    const ownership = ownershipRecord(input.hostname, dnspod && Boolean(input.includeAll))
    if (ownership) records.push(record('TXT', ownership.name, ownership.value, 'ownership_verification'))
  }
  return records
}
