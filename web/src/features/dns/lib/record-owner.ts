import type { DnsRecord, RecordOwner } from '@/features/dns/model/types'
import { ownValue } from '@/shared/lib/own-value'

const OWNER_LABELS: Record<RecordOwner, string> = {
  saas: 'SaaS',
  tunnel: '隧道',
  edgeone: 'EdgeOne',
  manual: '人工',
}

/**
 * 归属判定：只认词表自有键。
 * 判定与标签同源取自 OWNER_LABELS，二者不可能不同步；`in` 或裸查表会命中原型链
 * （'toString' in {} === true），命中的原型成员被当作归属后会被标签渲染成非字符串。
 */
function isRecordOwner(value: string): value is RecordOwner {
  return ownValue<string>(OWNER_LABELS, value) !== undefined
}

function ownerOf(record: DnsRecord): RecordOwner | '' {
  const owner = String(record.owner || '')
  return isRecordOwner(owner) ? owner : ''
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
