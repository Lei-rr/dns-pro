import { ownValue } from '@/shared/lib/own-value'

const DNS_ZONE_STATUS_LABELS: Record<string, string> = {
  enable: '已生效',
  enabled: '已生效',
  active: '已生效',
  online: '已生效',
  disable: '已停用',
  disabled: '已停用',
  offline: '已停用',
  pending: '配置中',
  processing: '处理中',
  forbidden: '已封禁',
  deleted: '已删除',
}

export function dnsZoneStatusLabel(status?: string | null) {
  const raw = String(status ?? '').trim()
  return ownValue(DNS_ZONE_STATUS_LABELS, raw.toLowerCase()) ?? (raw ? '状态未知' : '-')
}
