const GREEN = new Set(['active', 'active_renewing', 'moved'])
const GOLD = new Set(['pending', 'pending_validation', 'pending_issuance', 'pending_deployment', 'initializing'])
const RED = new Set(['deleted', 'blocked', 'pending_deletion', 'deactivated'])

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

export function statusLabel(status?: string | null) {
  if (!status) return '-'
  return STATUS_LABELS[String(status).toLowerCase()] || '状态未知'
}

export function statusVariant(
  status?: string | null
): 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning' {
  if (!status) return 'outline'
  // 与 statusLabel 同一口径：上游可能返回大写/混合大小写状态
  const key = String(status).toLowerCase()
  if (GREEN.has(key)) return 'success'
  if (RED.has(key)) return 'destructive'
  if (GOLD.has(key)) return 'warning'
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
  return GREEN.has(status) || RED.has(status)
}

/** 证书/SSL 状态是否已出结果（用于展示"处理中"提示） */
export function isSslSettled(status: string): boolean {
  return ['active', 'deleted', 'deactivated', 'pending_deletion'].includes(status)
}
