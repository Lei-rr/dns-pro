import { ApiError } from '../../kernel/http/api-error.js'
import type { DnsRecordValue } from '../../kernel/contracts/dns-record.port.js'
import type { CloudflareCustomHostname } from '../../domains/cloudflare/saas/saas-custom-hostname.client.js'
import type { SaaSHostnameService } from '../../domains/cloudflare/saas/saas-hostname.service.js'
import type { DesiredRecord } from '../derived-records/sync-plan.js'

type SyncResult = Record<string, unknown>

/** SaaS 同步目标厂商：DNSPod 与 Cloudflare DNS */
export type SaaSSyncProviderType = 'dnspod' | 'cloudflare'

/**
 * SaaS 记录快照：期望记录 + 写入目标。
 * 快照要跨阶段使用（删除/更新前收集，事后清理），因此自带 provider 与 zone。
 */
export interface SaaSSyncRecord extends DesiredRecord {
  /** 记录归属的服务商类型：清理阶段据此选择端口 */
  provider_type: SaaSSyncProviderType
  provider_id: string
  zone: string
}
export interface SyncCollectedRecords {
  hostname_fqdn: string
  records: SaaSSyncRecord[]
}

/** SaaS 主机名 DNS 同步目标的统一契约（DNSPod / Cloudflare DNS） */
export interface SaaSSyncAdapter {
  preflight(providerId: string, hostnameFqdn: string, data?: Record<string, unknown>): Promise<SyncResult>
  sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncResult>
  resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: SaaSSyncRecord[]
  ): Promise<SyncResult>
  cleanup(providerId: string, hostnameFqdn: string, records: SaaSSyncRecord[]): Promise<SyncResult>
  cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncResult>
  collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncCollectedRecords>
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

/** 业务回源：主机名自定义回源优先，否则站点默认回源 */
export async function resolveEffectiveOrigin(
  hostnames: SaaSHostnameService,
  providerId: string,
  cfZoneName: string,
  hostname: CloudflareCustomHostname
): Promise<string> {
  const custom = String(hostname.custom_origin_server ?? '').trim()
  return custom || ((await hostnames.fallbackOrigin(providerId, cfZoneName)) ?? '')
}

export function requireBusinessTarget(target: string): string {
  if (target.trim() === '')
    throw new ApiError('saas_business_target_missing', 'No business CNAME target available', 422)
  return target
}

/** DCV 委派 CNAME：优先使用 Cloudflare 返回的记录，否则用 UUID 推导 */
export function dcvDelegationRecords(hostname: CloudflareCustomHostname): Array<{ name: string; value: string }> {
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
export function ownershipRecord(hostname: CloudflareCustomHostname, forceName = false) {
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
}): SaaSSyncRecord {
  return {
    purpose: input.purpose,
    fqdn: input.fqdn,
    record: input.record,
    provider_type: input.provider_type,
    provider_id: input.provider_id,
    zone: input.zone,
  }
}

/** 清理配方：记录归属已由备注/值证明，keep=false 让写入口只删"自己的"记录 */
export const cleanupDesired = (record: SaaSSyncRecord): SaaSSyncRecord => ({ ...record, keep: false })

/** 记录稳定身份：类型|全名|线路（值变化视为同一记录原地更新） */
export function syncRecordIdentity(record: SaaSSyncRecord): string {
  const type = String(record.record.type ?? '')
    .trim()
    .toUpperCase()
  const name = record.fqdn.trim().toLowerCase().replace(/\.+$/, '')
  if (type === '' || name === '') return ''
  return [type, name, String(record.record.line ?? '').trim()].join('|')
}

/** 统计删除条数（写入口回执） */
export const countDeleted = (results: Array<{ status?: unknown }>) =>
  results.filter((result) => result.status === 'deleted').length

const acmeChallengeNameOf = (fqdn: string) => acmeChallengeName(fqdn)

/** Cloudflare 主机名已删除时的清理配方（值为空，按名称+类型+备注匹配） */
export function cloudflareDnsCleanupRecipe(fqdn: string, providerId: string, zoneName: string): SaaSSyncRecord[] {
  const target = { provider_type: 'cloudflare' as const, provider_id: providerId, zone: zoneName }
  const record = (type: string, name: string, purpose: string): SaaSSyncRecord =>
    desiredRecord({
      ...target,
      fqdn: name,
      purpose,
      record: { type, value: '', note: syncRemark(purpose, fqdn, CLOUDFLARE_ORIGIN_LABEL) },
    })
  return [
    record('CNAME', fqdn, 'origin_cname'),
    record('CNAME', acmeChallengeNameOf(fqdn), 'dcv_delegation'),
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
      record: { type, value: '', line, note: syncRemark(purpose, fqdn, DNSPOD_ORIGIN_LABEL) },
    })
  return [
    record('CNAME', fqdn, 'origin_cname'),
    record('CNAME', fqdn, 'preferred_cname', lines.preferred),
    record('CNAME', acmeChallengeNameOf(fqdn), 'dcv_delegation'),
    record('TXT', ownershipTxtName(fqdn), 'ownership_verification'),
  ]
}
