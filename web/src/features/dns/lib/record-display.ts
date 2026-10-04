import type { DnsRecord } from '@/features/dns/model/types'
import {
  compareRecordsForGroup,
  hostGroupLabel,
  recordHostKey,
  shouldCollapseHostGroup,
} from '@/features/dns/lib/record-remark'

export type DnsRecordDisplayRow =
  | { kind: 'single'; record: DnsRecord; key: string }
  | { kind: 'group'; hostKey: string; label: string; records: DnsRecord[]; key: string }

/** Build the display-only host groups used by the DNS records table. */
export function buildDnsRecordDisplayRows(records: DnsRecord[], zoneName: string): DnsRecordDisplayRow[] {
  const sorted = [...records].sort((a, b) => compareRecordsForGroup(a, b, zoneName))
  const rows: DnsRecordDisplayRow[] = []

  for (let i = 0; i < sorted.length;) {
    // Index bounds are guaranteed by the loop conditions; the casts keep the grouping scan linear.
    const record = sorted[i] as DnsRecord
    const hostKey = recordHostKey(record, zoneName)
    let end = i + 1
    while (end < sorted.length && recordHostKey(sorted[end] as DnsRecord, zoneName) === hostKey) end++

    const chunk = sorted.slice(i, end)
    if (shouldCollapseHostGroup(chunk, zoneName)) {
      rows.push({
        kind: 'group',
        hostKey,
        label: hostGroupLabel(hostKey, zoneName),
        records: chunk,
        key: `g:${hostKey}`,
      })
    } else {
      rows.push(
        ...chunk.map((item) => ({
          kind: 'single' as const,
          record: item,
          key: `r:${dnsRecordRowKey(item)}`,
        }))
      )
    }
    i = end
  }

  // 按排序顺序返回：分组与单条混排，不能再把分组整体前置
  return rows
}

export function dnsRecordRowKey(record: DnsRecord): string {
  return String(record.id || `${record.name || ''}·${record.type || ''}·${record.value || ''}·${record.line || ''}`)
}

export function dnsRecordMatchesKeyword(record: DnsRecord, keyword: string): boolean {
  if (!keyword) return false
  return [record.name, record.type, record.value, record.content, record.remark, record.comment, record.line]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
    .includes(keyword)
}

export function dnsRecordTtlDisplay(ttl?: number | string | null): string {
  if (ttl === 1 || ttl === '1') return '自动'
  if (ttl == null || ttl === '') return '-'
  return String(ttl)
}
