const GREEN = new Set(['active', 'active_renewing', 'moved'])
const GOLD = new Set(['pending', 'pending_validation', 'pending_issuance', 'pending_deployment', 'initializing'])
const RED = new Set(['deleted', 'blocked', 'pending_deletion'])

export function statusColor(status: string) {
  if (GREEN.has(status)) return 'green'
  if (GOLD.has(status)) return 'gold'
  if (RED.has(status)) return 'red'
  return status ? 'blue' : 'default'
}

const STATUS_LABELS: Record<string, string> = {
  active: '有效',
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

export function statusLabel(status: string) {
  if (!status) return '-'
  return STATUS_LABELS[status] || status
}

const TLS_LABELS: Record<string, string> = {
  '1.0': 'TLS 1.0（默认）',
  '1.1': 'TLS 1.1',
  '1.2': 'TLS 1.2',
  '1.3': 'TLS 1.3',
}

export function minTlsLabel(value: string) {
  return TLS_LABELS[value] || value || '-'
}

export function formatDate(value: string) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function filterOption(input: string, option: { value: string }) {
  return String(option.value || '').toLowerCase().includes(String(input || '').toLowerCase())
}
