import type { AuditAction, DerivedStatus, SourceKind, SyncAction } from '../model/types'

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning'

/** 派生记录状态 → 中文标签与徽章色（与后端 status 词汇一一对应） */
const STATUS_META: Record<DerivedStatus, { label: string; variant: BadgeVariant }> = {
  synced: { label: '已同步', variant: 'success' },
  drifted: { label: '有漂移', variant: 'warning' },
  missing: { label: '缺失', variant: 'destructive' },
  failed: { label: '失败', variant: 'destructive' },
}

/** 徽章色 → 计数文字色：计数卡片与徽章同源取色，避免第二份状态词表 */
const VARIANT_TONE: Record<BadgeVariant, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  destructive: 'text-destructive',
  default: 'text-foreground',
  secondary: 'text-muted-foreground',
  outline: 'text-foreground',
}

/** 来源类型标签 */
const SOURCE_LABEL: Record<SourceKind, string> = {
  'saas-hostname': 'SaaS 主机名',
  'tunnel-route': '隧道路由',
  'edgeone-domain': 'EdgeOne 加速域名',
}

/** 对账动作标签（delete 不会被自动执行；cleanup 为执行期的冲突清理结果，与 dns-writer 的 action 一致） */
export const ACTION_LABEL: Record<SyncAction | 'cleanup', string> = {
  create: '待创建',
  update: '待更新',
  delete: '待删除',
  unchanged: '无需变更',
  cleanup: '冲突清理',
}

/** F6 审计动作 → 中文标签与徽章色 */
const AUDIT_META: Record<AuditAction, { label: string; variant: BadgeVariant }> = {
  batch: { label: '批量操作', variant: 'secondary' },
  credential_change: { label: '凭据变更', variant: 'warning' },
  session_revoked: { label: '会话吊销', variant: 'destructive' },
}

/** 未知来源只回中文兜底，原始值由调用方放进 title 便于排查 */
export function sourceLabel(kind: string): string {
  return SOURCE_LABEL[kind as SourceKind] ?? '未知来源'
}

export function statusMeta(status: string) {
  return STATUS_META[status as DerivedStatus] ?? { label: '状态未知', variant: 'secondary' as BadgeVariant }
}

/** 状态 → 计数文字色（未知状态走兜底色） */
export function statusTone(status: string): string {
  return VARIANT_TONE[statusMeta(status).variant]
}

/** 审计动作 → 标签与徽章色；未知动作同样只回中文兜底 */
export function auditMeta(action: AuditAction) {
  return AUDIT_META[action] ?? { label: '未知动作', variant: 'secondary' as BadgeVariant }
}
