import type { DnsRecord, RecordOwner } from '@/features/dns/model/types'

const OWNER_LABELS: Record<RecordOwner, string> = {
  saas: 'SaaS',
  tunnel: '隧道',
  edgeone: 'EdgeOne',
  manual: '人工',
}

function ownerOf(record: DnsRecord): RecordOwner | '' {
  const owner = String(record.owner || '')
  return owner in OWNER_LABELS ? (owner as RecordOwner) : ''
}

/** D4 归属徽标文案：后端未返回归属时为空串（不渲染徽标） */
export function recordOwnerLabel(record: DnsRecord): string {
  const owner = ownerOf(record)
  return owner === '' ? '' : OWNER_LABELS[owner]
}

/** D4 归属说明：manual 表示无派生归属，自动化流程不会删除该记录 */
export function recordOwnerHint(record: DnsRecord): string {
  const owner = ownerOf(record)
  if (owner === '') return ''
  return owner === 'manual'
    ? '无派生归属：自动化流程不会删除该记录'
    : `由 ${OWNER_LABELS[owner]} 派生关系管理，写入前校验归属`
}
