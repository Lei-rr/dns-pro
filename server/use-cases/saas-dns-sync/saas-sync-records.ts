/**
 * SaaS 主机名 DNS 同步的目标契约（DNSPod / Cloudflare DNS）。
 *
 * 期望记录构造与目标解析的唯一实现在 `derived-records/planners/saas.planner.ts`：
 * 写入适配器与对账检测共用同一判据，避免"同步"与"对账"两套语义漂移。
 */
import type { CloudflareCustomHostname } from '../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import {
  cleanupDesired,
  syncRecordIdentity,
  type SaaSSyncProviderType,
  type SaaSSyncRecord,
  type SyncCollectedRecords,
} from '../derived-records/planners/saas.planner.js'

type SyncResult = Record<string, unknown>

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
  cleanupStaleRecords(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    /** 调用方已取到的新鲜快照；缺省时自行强制刷新读取 */
    hostname?: CloudflareCustomHostname
  ): Promise<SyncResult>
  collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncCollectedRecords>
}

/** 更新后不再需要的记录：仅取属于当前同步目标、且新记录集中已消失的条目（按身份去重） */
export function orphanRecords(
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
