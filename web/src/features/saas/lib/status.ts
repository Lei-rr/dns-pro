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

export function statusVariant(status?: string | null): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (!status) return 'outline'
  if (GREEN.has(status)) return 'secondary'
  if (RED.has(status)) return 'destructive'
  if (GOLD.has(status)) return 'secondary'
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
