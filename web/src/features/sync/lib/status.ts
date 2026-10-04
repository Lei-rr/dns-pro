import type { AuditAction, DerivedStatus, SourceKind, SyncAction } from '../model/types'

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning'

/** 派生记录状态 → 中文标签与徽章色（与后端 status 词汇一一对应） */
const STATUS_META: Record<DerivedStatus, { label: string; variant: BadgeVariant }> = {
  synced: { label: '已同步', variant: 'success' },
  drifted: { label: '有漂移', variant: 'warning' },
  missing: { label: '缺失', variant: 'destructive' },
  failed: { label: '失败', variant: 'destructive' },
}

/** 来源类型标签 */
const SOURCE_LABEL: Record<SourceKind, string> = {
  'saas-hostname': 'SaaS 主机名',
  'tunnel-route': '隧道路由',
  'edgeone-domain': 'EdgeOne 加速域名',
}

/** 对账动作标签（delete 不会被自动执行） */
export const ACTION_LABEL: Record<SyncAction, string> = {
  create: '待创建',
  update: '待更新',
  delete: '待删除',
  unchanged: '无需变更',
}

/** F6 审计动作标签 */
export const AUDIT_LABEL: Record<AuditAction, string> = {
  batch: '批量操作',
  credential_change: '凭据变更',
  session_revoked: '会话吊销',
}

export function sourceLabel(kind: string): string {
  return SOURCE_LABEL[kind as SourceKind] ?? kind
}

export function statusMeta(status: string) {
  return STATUS_META[status as DerivedStatus] ?? { label: status, variant: 'secondary' as BadgeVariant }
}
