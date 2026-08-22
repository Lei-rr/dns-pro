import type { DnsRecord } from '../model/types'

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function exportRecordsAsJson(records: DnsRecord[], zoneName: string) {
  const data = JSON.stringify(records, null, 2)
  downloadFile(data, `${zoneName}_dns_records.json`, 'application/json')
}

export function exportRecordsAsCsv(records: DnsRecord[], zoneName: string) {
  const headers = [
    '名称 (Name)',
    '类型 (Type)',
    '记录值 (Value)',
    'TTL',
    '线路 (Line)',
    'CDN/代理 (Proxied)',
    '备注 (Remark)',
    'MX优先级 (Priority)',
  ]
  const rows = records.map((r) => [
    `"${String(r.name ?? '').replace(/"/g, '""')}"`,
    `"${String(r.type ?? '').replace(/"/g, '""')}"`,
    `"${String(r.value ?? r.content ?? '').replace(/"/g, '""')}"`,
    `"${String(r.ttl ?? 600)}"`,
    `"${String(r.line ?? '默认').replace(/"/g, '""')}"`,
    `"${r.proxied ? 'true' : 'false'}"`,
    `"${String(r.remark ?? r.comment ?? '').replace(/"/g, '""')}"`,
    `"${String(r.priority ?? r.mx ?? '')}"`,
  ])
  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n')
  downloadFile(csvContent, `${zoneName}_dns_records.csv`, 'text/csv;charset=utf-8;')
}

export function exportRecordsAsZone(records: DnsRecord[], zoneName: string) {
  const lines: string[] = [
    `; Zone file for ${zoneName}`,
    `; Exported at ${new Date().toISOString()}`,
    `$ORIGIN ${zoneName}.`,
    `$TTL 600`,
    '',
  ]

  for (const r of records) {
    const name = String(r.name ?? '@')
    const ttl = String(r.ttl ?? 600)
    const type = String(r.type ?? 'A').toUpperCase()
    const value = String(r.value ?? r.content ?? '')
    const formattedName = name.padEnd(20, ' ')
    const formattedTtl = ttl.padEnd(8, ' ')
    const formattedType = type.padEnd(8, ' ')

    if (type === 'MX') {
      const priority = String(r.priority ?? r.mx ?? '10')
      lines.push(`${formattedName} ${formattedTtl} IN ${formattedType} ${priority} ${value}`)
    } else if (type === 'TXT') {
      lines.push(`${formattedName} ${formattedTtl} IN ${formattedType} "${value.replace(/"/g, '\\"')}"`)
    } else {
      lines.push(`${formattedName} ${formattedTtl} IN ${formattedType} ${value}`)
    }
  }

  downloadFile(lines.join('\n'), `${zoneName}.zone`, 'text/plain')
}
