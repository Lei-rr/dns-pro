/**
 * SaaS 主机名 DNS 同步的目标契约（DNSPod / Cloudflare DNS）。
 *
 * 期望记录构造与目标解析的唯一实现在 `derived-records/planners/saas.planner.ts`：
 * 写入适配器与对账检测共用同一判据，避免"同步"与"对账"两套语义漂移。
 */
import type { CloudflareCustomHostname } from '../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import type { DnsWriter, WriteOutcome } from '../derived-records/dns-writer.js'
import {
  cleanupDesired,
  saasDesiredRecords,
  syncRecordIdentity,
  type SaaSSyncProviderType,
  type SaaSSyncRecord,
  type SyncCollectedRecords,
} from '../derived-records/planners/saas.planner.js'

/** 写入回执：DnsWriter 逐条结果 */
type SaaSSyncWriteResults = WriteOutcome[]

/** 预检结果：目标按各自厂商填充（DNSPod 填 dnspod_*，Cloudflare 填 cloudflare_*） */
type SaaSSyncPreflightResult = {
  hostname_fqdn: string
  dnspod_provider_id?: string
  dnspod_zone?: string
  cloudflare_provider_id?: string
  cloudflare_zone_id?: string
  cloudflare_zone?: string
}

/** 同步/重同步结果；reason 非空表示目标不可解析（未执行写入） */
type SaaSSyncResult = {
  hostname_fqdn?: string
  hostname?: string
  dnspod_zone?: string
  cloudflare_provider_id?: string
  cloudflare_zone?: string
  precleaned?: SaaSSyncWriteResults
  deleted?: SaaSSyncWriteResults
  cleaned?: number
  reason?: string
  records: SaaSSyncWriteResults
}

/** 清理结果；cleaned 为实际删除条数，reason 非空表示跳过 */
type SaaSSyncCleanupResult = {
  cleaned: number
  dnspod_zone?: string
  cloudflare_zone?: string
  reason?: string
  records: SaaSSyncWriteResults
}

/** 激活后清理所有权 TXT 的结果：未激活/无 FQDN 时只带 reason */
type SaaSSyncStaleCleanupResult = {
  cleaned: number
  dnspod_zone?: string
  cloudflare_zone?: string
  reason?: string
  records?: SaaSSyncWriteResults
}

/** SaaS 主机名 DNS 同步目标的统一契约（DNSPod / Cloudflare DNS） */
export interface SaaSSyncAdapter {
  preflight(providerId: string, hostnameFqdn: string, data?: Record<string, unknown>): Promise<SaaSSyncPreflightResult>
  sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SaaSSyncResult>
  resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: SaaSSyncRecord[]
  ): Promise<SaaSSyncResult>
  cleanup(providerId: string, hostnameFqdn: string, records: SaaSSyncRecord[]): Promise<SaaSSyncCleanupResult>
  cleanupStaleRecords(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    /** 调用方已取到的新鲜快照；缺省时自行强制刷新读取 */
    hostname?: CloudflareCustomHostname
  ): Promise<SaaSSyncStaleCleanupResult>
  collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncCollectedRecords>
}

/** 期望记录：写入与对账共用 saasDesiredRecords（单一来源），两个适配器只差 providerType */
export function saasTargetRecords(
  providerType: SaaSSyncProviderType,
  hostname: CloudflareCustomHostname,
  target: { providerId: string; zone: string },
  origin: string,
  includeAll = false
): SaaSSyncRecord[] {
  return saasDesiredRecords({
    hostname,
    providerType,
    providerId: target.providerId,
    zone: target.zone,
    origin,
    includeAll,
  })
}

/** 更新后不再需要的记录：按身份差集一次清理（值或备注可证明归属） */
export async function deleteRemovedRecords(
  writer: DnsWriter,
  providerType: SaaSSyncProviderType,
  target: { providerId: string; zone: string },
  beforeRecords: SaaSSyncRecord[],
  afterRecords: SaaSSyncRecord[]
): Promise<SaaSSyncWriteResults> {
  const orphans = orphanRecords({ providerType, ...target }, beforeRecords, afterRecords)
  return orphans.length === 0 ? [] : writer.sync(providerType, target.providerId, target.zone, orphans)
}

/** 更新后不再需要的记录：仅取属于当前同步目标、且新记录集中已消失的条目（按身份去重） */
function orphanRecords(
  target: { providerType: SaaSSyncProviderType; providerId: string; zone: string },
  beforeRecords: SaaSSyncRecord[],
  afterRecords: SaaSSyncRecord[]
): SaaSSyncRecord[] {
  const retained = new Set(afterRecords.map(syncRecordIdentity))
  const seen = new Set<string>()
  const orphans: SaaSSyncRecord[] = []
  for (const record of beforeRecords) {
    // 切换 sync_target/sync_zone 后旧目标的快照仍会传入：不过滤会把删除指令打到新目标
    if (record.provider_type !== target.providerType) continue
    if (record.provider_id !== target.providerId || record.zone !== target.zone) continue
    const key = syncRecordIdentity(record)
    if (key === '' || seen.has(key) || retained.has(key)) continue
    seen.add(key)
    orphans.push(cleanupDesired(record))
  }
  return orphans
}
