/**
 * 派生记录视图类型。
 *
 * 词汇表（来源/状态/动作/写入结果/归属）type-only 复用后端定义：
 * 手工镜像的联合一旦与后端漂移，只能等运行期才暴露；后端这些联合本就是同一份契约的一部分。
 * @server 导入在构建期擦除，跨项目运行时导入由 ARCH032 禁止、type-only 合法。
 */
import type { DerivedOwner } from '@server/core/contracts/ownership.port.js'
import type { WriteOutcome } from '@server/workflows/derived-records/dns-writer.js'
import type { DerivedStatus, SourceKind } from '@server/workflows/derived-records/derived-record.types.js'
import type { SyncAction } from '@server/workflows/derived-records/sync-plan.js'

export type { DerivedStatus, SourceKind, SyncAction }

type DerivedSource = { kind: SourceKind; providerId: string; id: string }

/** 目标服务商：后端 DerivedTarget.providerType 本身是 string（没有闭合联合），前端保持同一口径 */
type DerivedTarget = { providerType: string; providerId: string; zone: string; fqdn: string }

/** 期望记录（后端 desired 的可视化投影：只读渲染要容忍字段缺失，故 record 全部可选） */
type DesiredRecordView = {
  purpose: string
  fqdn: string
  owner: DerivedOwner
  refId?: string
  record: {
    type?: string
    value?: string
    line?: string
    ttl?: number
    note?: string
    proxied?: boolean
  }
}

type CurrentRecordView = { id: string; value: { type?: string; value?: string; line?: string; ttl?: number } }

/** 单条派生记录的对账结果（检测只读，执行后才可能变为 synced） */
export type ReconcileItem = {
  source: DerivedSource
  target: DerivedTarget
  owner: DerivedOwner
  purpose: string
  desired: DesiredRecordView
  status: DerivedStatus
  lastSyncedAt: string | null
  action: SyncAction
  current: CurrentRecordView | null
  error?: string
}

export type ReconcileSummary = {
  total: number
  synced: number
  drifted: number
  missing: number
  failed: number
}

/** 对账范围：按声明方或 DNS 目标服务商过滤，可选来源类型 */
export type ReconcileScope = { providerId?: string; kind?: SourceKind }

export type ReconcileReport = {
  scanned_at: string
  scope: ReconcileScope
  items: ReconcileItem[]
  summary: ReconcileSummary
}

/** 逐条写入结果：与后端 WriteOutcome 同形（action 额外含执行期的 cleanup） */
type WriteOutcomeView = WriteOutcome

/** 执行结果：在检测报告之上补齐执行时间与逐条写入结果 */
export type ReconcileResult = ReconcileReport & { executed_at: string; results: WriteOutcomeView[] }

/**
 * F6 审计动作：批量 / 凭据变更 / 会话吊销 / 派生记录对账。
 * 未复用后端 AuditAction：其定义文件 audit-log.ts 声明了 fastify 的 request.authActor 类型增强，
 * web 侧没有该增强、type-only 导入同样会解析失败——这里的镜像只能靠后端改动时的搜索来对账。
 */
export type AuditAction = 'batch' | 'credential_change' | 'session_revoked' | 'reconcile'

export type AuditEvent = {
  id: string
  at: string
  action: AuditAction
  actor: string
  target: string
  detail: Record<string, unknown>
}
