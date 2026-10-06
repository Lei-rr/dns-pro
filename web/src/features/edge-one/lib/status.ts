import type { BadgeVariants } from '@/shared/ui/badge'
import { ownValue } from '@/shared/lib/own-value'

const EDGE_ONE_STATUS_LABELS: Record<string, string> = {
  online: '已生效',
  process: '配置中',
  offline: '已停用',
  forbidden: '已封禁',
  init: '未生效',
  active: '已生效',
  pending: '配置中',
}

export function edgeOneStatusLabel(status?: string) {
  const key = String(status ?? '')
    .trim()
    .toLowerCase()
  return ownValue(EDGE_ONE_STATUS_LABELS, key) ?? (key ? '状态未知' : '-')
}

const EDGE_ONE_ACCESS_LABELS: Record<string, string> = {
  dnsPodAccess: 'DNSPod',
  partial: 'CNAME',
  full: '全量',
  noDomainAccess: '无域名',
  pages: 'Pages',
  ai: 'AI',
}

/** EdgeOne zone.Type is access mode, not an ID. */
export function edgeOneAccessLabel(type?: string) {
  const raw = String(type ?? '')
  return ownValue(EDGE_ONE_ACCESS_LABELS, raw) ?? ownValue(EDGE_ONE_ACCESS_LABELS, raw.toLowerCase()) ?? (raw || '-')
}

const CERTIFICATE_STATUS_LABELS: Record<string, string> = {
  applying: '申请中',
  deployed: '已部署',
  processing: '部署中',
  failed: '申请失败',
}

export function certificateStatusLabel(status?: string) {
  const key = String(status ?? '')
    .trim()
    .toLowerCase()
  return ownValue(CERTIFICATE_STATUS_LABELS, key) ?? (key ? '状态未知' : '-')
}

export function edgeOneHttpsStatusLabel(certificate?: {
  mode?: string
  items?: Array<{ status?: string }>
  list?: Array<{ status?: string }>
}) {
  const mode = String(certificate?.mode || 'disable').toLowerCase()
  if (mode === 'disable') return '未开启'
  const status = (certificate?.items || certificate?.list || [])[0]?.status
  return status ? certificateStatusLabel(status) : '已开启'
}

/** 徽章色与 Badge 组件的变体同源，避免手抄联合类型随组件增删而漂移（cva 的变体含 null/undefined，此处收窄） */
type BadgeVariant = NonNullable<BadgeVariants['variant']>

/** 状态 → 徽章色：与 edgeOneStatusLabel/certificateStatusLabel 的词表对齐 */
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  online: 'success',
  active: 'success',
  deployed: 'success',
  process: 'warning',
  pending: 'warning',
  init: 'warning',
  applying: 'warning',
  processing: 'warning',
  offline: 'destructive',
  forbidden: 'destructive',
  failed: 'destructive',
}

export function edgeOneStatusVariant(status?: string): BadgeVariant {
  const key = String(status ?? '')
    .trim()
    .toLowerCase()
  return ownValue(STATUS_VARIANTS, key) ?? 'outline'
}

/** HTTPS 展示（判定同 edgeOneHttpsStatusLabel）→ 徽章色 */
export function edgeOneHttpsVariant(certificate?: {
  mode?: string
  items?: Array<{ status?: string }>
  list?: Array<{ status?: string }>
}): BadgeVariant {
  const mode = String(certificate?.mode || 'disable').toLowerCase()
  if (mode === 'disable') return 'outline'
  const status = (certificate?.items || certificate?.list || [])[0]?.status
  return status ? edgeOneStatusVariant(status) : 'secondary'
}
