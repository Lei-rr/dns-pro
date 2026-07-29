import type { DnsRecord } from '@/shared/types'
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
  const groups: DnsRecordDisplayRow[] = []
  const singles: DnsRecordDisplayRow[] = []

  for (let i = 0; i < sorted.length;) {
    const record = sorted[i]
    const hostKey = recordHostKey(record, zoneName)
    let end = i + 1
    while (end < sorted.length && recordHostKey(sorted[end], zoneName) === hostKey) end++

    const chunk = sorted.slice(i, end)
    if (shouldCollapseHostGroup(chunk, zoneName)) {
      groups.push({
        kind: 'group',
        hostKey,
        label: hostGroupLabel(hostKey, zoneName),
        records: chunk,
        key: `g:${hostKey}`,
      })
    } else {
      singles.push(
        ...chunk.map((item) => ({
          kind: 'single' as const,
          record: item,
          key: `r:${dnsRecordRowKey(item)}`,
        })),
      )
    }
    i = end
  }

  return [...groups, ...singles]
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
