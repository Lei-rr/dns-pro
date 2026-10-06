import type { DnsRecord } from '@/features/dns/model/types'
import {
  compareRecordsForGroup,
  hostGroupLabel,
  recordHostKey,
  shouldCollapseHostGroup,
  type RecordLike,
} from '@/features/dns/lib/record-group'
import { inferRecordPurpose } from '@/features/dns/lib/record-purpose'

export type DnsRecordDisplayRow =
  | { kind: 'single'; record: DnsRecord; key: string }
  | { kind: 'group'; hostKey: string; label: string; records: DnsRecord[]; key: string }

/**
 * Build the display-only host groups used by the DNS records table.
 *
 * 折叠组整体前置，单条记录随后：折叠行是「摘要」，散在单条之间会把列表切成碎片，
 * 也让「当前有几组折叠、各自多少条」无法一眼扫完。组内与组间顺序仍由 compareRecordsForGroup 决定。
 */
export function buildDnsRecordDisplayRows(records: DnsRecord[], zoneName: string): DnsRecordDisplayRow[] {
  const sorted = [...records].sort((a, b) => compareRecordsForGroup(a, b, zoneName))
  const groups: DnsRecordDisplayRow[] = []
  const singles: DnsRecordDisplayRow[] = []

  for (let i = 0; i < sorted.length;) {
    // Index bounds are guaranteed by the loop conditions; the casts keep the grouping scan linear.
    const record = sorted[i] as DnsRecord
    const hostKey = recordHostKey(record, zoneName)
    let end = i + 1
    while (end < sorted.length && recordHostKey(sorted[end] as DnsRecord, zoneName) === hostKey) end++

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
        }))
      )
    }
    i = end
  }

  return [...groups, ...singles]
}

export function dnsRecordRowKey(record: DnsRecord): string {
  return String(record.id || `${record.name || ''}·${record.type || ''}·${record.value || ''}·${record.line || ''}`)
}

/**
 * 展示行展开为记录集合：分组行携带整组记录（分组先于分页，组不会跨页分裂），单条行就是它自己。
 * 用于把「当前页展示行」折算成表头全选/批量操作需要覆盖的记录口径。
 */
export function recordsOfDisplayRows(rows: DnsRecordDisplayRow[]): DnsRecord[] {
  return rows.flatMap((row) => (row.kind === 'group' ? row.records : [row.record]))
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

/** 组头徽章固定顺序 */
const PURPOSE_LABEL_ORDER = ['默认回源', '优选域名', 'DCV委派', '所有权验证', 'MX', 'SPF', 'DKIM', 'DMARC'] as const

const PURPOSE_LABEL_SET: ReadonlySet<string> = new Set<string>(PURPOSE_LABEL_ORDER)

/** 组头用途徽章：固定顺序在前，只显示本组有的；固定顺序之外的标签按出现顺序追加 */
export function orderedPurposeLabels(records: RecordLike[], zoneName = ''): string[] {
  const present = new Set<string>()
  const extras: string[] = []
  for (const record of records) {
    const { isLinked, purposeLabel } = inferRecordPurpose(record, zoneName)
    if (!isLinked || !purposeLabel) continue
    if (PURPOSE_LABEL_SET.has(purposeLabel)) present.add(purposeLabel)
    else if (!extras.includes(purposeLabel)) extras.push(purposeLabel)
  }
  return [...PURPOSE_LABEL_ORDER.filter((label) => present.has(label)), ...extras]
}
