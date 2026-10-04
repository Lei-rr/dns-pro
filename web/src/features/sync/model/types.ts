/** 派生记录来源类型：与后端 SourceKind 一一对应 */
export type SourceKind = 'saas-hostname' | 'tunnel-route' | 'edgeone-domain'

/** 同步健康状态：synced=与期望一致，drifted=存在但值不同，missing=缺失，failed=检测或执行失败 */
export type DerivedStatus = 'synced' | 'drifted' | 'missing' | 'failed'

export type SyncAction = 'create' | 'update' | 'delete' | 'unchanged'

type DerivedSource = { kind: SourceKind; providerId: string; id: string }

type DerivedTarget = { providerType: string; providerId: string; zone: string; fqdn: string }

/** 期望记录（后端 desired 的可视化投影） */
type DesiredRecordView = {
  purpose: string
  fqdn: string
  owner: string
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
  owner: string
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

type WriteOutcomeView = {
  purpose: string
  action: string
  status: string
  fqdn: string
  value: string
  record_id: string
  error?: string
}

/** 执行结果：在检测报告之上补齐执行时间与逐条写入结果 */
export type ReconcileResult = ReconcileReport & { executed_at: string; results: WriteOutcomeView[] }

/** F6 审计动作：批量 / 凭据变更 / 会话吊销 */
export type AuditAction = 'batch' | 'credential_change' | 'session_revoked'

export type AuditEvent = {
  id: string
  at: string
  action: AuditAction
  actor: string
  target: string
  detail: Record<string, unknown>
}
