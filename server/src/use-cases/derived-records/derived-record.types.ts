/**
 * 派生记录的统一词汇（蓝图 §4.2 派生记录：同步一等公民）。
 *
 * 三条产品线（SaaS 主机名 / 隧道路由 / EdgeOne 加速域名）产出的记录都投影成
 * 同一形状，检测与执行共用：检测只读，执行经 DnsWriter。
 * 注意：不持久化派生关系表，`lastSyncedAt` 恒为 null。
 */
import type { DnsRecordValue } from '../../kernel/contracts/dns-record.port.js'
import type { DerivedOwner } from '../../kernel/contracts/ownership.port.js'
import type { DesiredRecord, SyncAction } from './sync-plan.js'

/** 派生关系来源类型（声明者） */
export type SourceKind = 'saas-hostname' | 'tunnel-route' | 'edgeone-domain'

/** 派生记录状态：synced=与期望一致，drifted=存在但值不同，missing=缺失，failed=检测或执行失败 */
export type DerivedStatus = 'synced' | 'drifted' | 'missing' | 'failed'

type DerivedSource = { kind: SourceKind; providerId: string; id: string }

type DerivedTarget = { providerType: string; providerId: string; zone: string; fqdn: string }

/** 一条派生关系：来源声明 → DNS 目标（期望记录 + 归属） */
type DerivedRecord = {
  source: DerivedSource
  target: DerivedTarget
  owner: DerivedOwner
  purpose: string
  desired: DesiredRecord
  status: DerivedStatus
  lastSyncedAt: string | null
}

/** planner 产出的记录（尚未检测，无状态） */
export type PlannedRecord = Omit<DerivedRecord, 'status' | 'lastSyncedAt'>

/** 对账范围：按声明方或 DNS 目标服务商过滤，可选来源类型 */
export type ReconcileScope = { providerId?: string; kind?: SourceKind }

/** 派生记录来源扫描器：只读遍历声明者，产出期望记录 */
export interface DerivedSourcePlanner {
  kind: SourceKind
  scan(scope: ReconcileScope): Promise<PlannedRecord[]>
}

/** 检测结果：在期望记录上补齐现状与判定 */
export interface ReconcileItem extends DerivedRecord {
  action: SyncAction
  current: { id: string; value: DnsRecordValue } | null
  error?: string
}

export type ReconcileSummary = {
  total: number
  synced: number
  drifted: number
  missing: number
  failed: number
}

/** 只读检测报告：F1 同步健康视图与 F2 对账入口共用同一形状 */
export type ReconcileReport = {
  scanned_at: string
  scope: ReconcileScope
  items: ReconcileItem[]
  summary: ReconcileSummary
}
