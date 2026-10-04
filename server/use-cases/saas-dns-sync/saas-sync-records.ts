/**
 * SaaS 主机名 DNS 同步的目标契约（DNSPod / Cloudflare DNS）。
 *
 * 期望记录构造与目标解析的唯一实现在 `derived-records/planners/saas.planner.ts`：
 * 写入适配器与对账检测共用同一判据，避免"同步"与"对账"两套语义漂移。
 */
import type { SaaSSyncRecord, SyncCollectedRecords } from '../derived-records/planners/saas.planner.js'

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
  cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncResult>
  collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<SyncCollectedRecords>
}
