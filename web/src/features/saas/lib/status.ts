import type { BadgeVariants } from '@/shared/ui/badge'

const GREEN = new Set(['active', 'active_renewing', 'moved'])
const GOLD = new Set(['pending', 'pending_validation', 'pending_issuance', 'pending_deployment', 'initializing'])
const RED = new Set(['deleted', 'blocked', 'pending_deletion', 'deactivated'])
const SSL_SETTLED = new Set(['active', 'deleted', 'deactivated', 'pending_deletion'])

const STATUS_LABELS: Record<string, string> = {
  active: '已生效',
  active_renewing: '续期中',
  pending: '待处理',
  pending_validation: '待验证',
  pending_issuance: '签发中',
  pending_deployment: '部署中',
  pending_deletion: '删除中',
  pending_blocked: '待禁用',
  initializing: '初始化中',
  moved: '已迁移',
  deleted: '已删除',
  blocked: '已禁用',
  deactivated: '已停用',
}

const TLS_LABELS: Record<string, string> = {
  '1.0': 'TLS 1.0',
  '1.1': 'TLS 1.1',
  '1.2': 'TLS 1.2',
  '1.3': 'TLS 1.3',
}

/** 状态归一：上游可能返回大写/混合大小写，标签、徽章与终态判定共用这一份比较键 */
function statusKey(status?: string | null) {
  return String(status ?? '').toLowerCase()
}

export function statusLabel(status?: string | null) {
  if (!status) return '-'
  return STATUS_LABELS[statusKey(status)] || '状态未知'
}

/**
 * 状态 → 徽章色：标签统一只用灰/黑三档（secondary 常态 / outline 中间态 / default 异常），
 * 语义靠文案区分，不靠色相。跨模块的小标签外观因此保持一致。
 */
export function statusVariant(status?: string | null): NonNullable<BadgeVariants['variant']> {
  if (!status) return 'outline'
  const key = statusKey(status)
  if (GREEN.has(key)) return 'secondary'
  if (RED.has(key)) return 'default'
  if (GOLD.has(key)) return 'outline'
  return 'outline'
}

export function minTlsLabel(value?: string | null) {
  if (!value) return '-'
  return TLS_LABELS[value] || value
}

export function formatDate(value?: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 主机名是否已到达终态（不再需要所有权验证帮助） */
export function isHostnameSettled(status: string): boolean {
  const key = statusKey(status)
  return GREEN.has(key) || RED.has(key)
}

/** 证书/SSL 状态是否已出结果（用于展示"处理中"提示） */
export function isSslSettled(status: string): boolean {
  return SSL_SETTLED.has(statusKey(status))
}
