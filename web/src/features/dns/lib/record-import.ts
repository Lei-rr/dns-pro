export type ParsedImportRecord = {
  name: string
  type: string
  value: string
  ttl?: number
  line?: string
  priority?: number
  remark?: string
  proxied?: boolean
}

export function parseJsonRecords(text: string): ParsedImportRecord[] {
  const data = JSON.parse(text)
  if (!Array.isArray(data)) {
    throw new Error('JSON 内容必须是记录对象数组')
  }

  const results: ParsedImportRecord[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const name = String(obj.name ?? obj.subdomain ?? '@').trim() || '@'
    const type = String(obj.type ?? obj.record_type ?? 'A')
      .trim()
      .toUpperCase()
    const value = String(obj.value ?? obj.content ?? '').trim()
    if (!value) continue

    const rec: ParsedImportRecord = { name, type, value }
    if (obj.ttl != null && obj.ttl !== '') {
      const ttlNum = Number(obj.ttl)
      if (Number.isFinite(ttlNum) && ttlNum > 0) rec.ttl = ttlNum
    }
    if (obj.line != null && String(obj.line).trim()) {
      rec.line = String(obj.line).trim()
    }
    if (obj.priority != null && obj.priority !== '') {
      const prioNum = Number(obj.priority)
      if (Number.isFinite(prioNum)) rec.priority = prioNum
    } else if (obj.mx != null && obj.mx !== '') {
      const mxNum = Number(obj.mx)
      if (Number.isFinite(mxNum)) rec.priority = mxNum
    }
    if (obj.remark != null && String(obj.remark).trim()) {
      rec.remark = String(obj.remark).trim()
    } else if (obj.comment != null && String(obj.comment).trim()) {
      rec.remark = String(obj.comment).trim()
    }
    if (obj.proxied != null) {
      rec.proxied = Boolean(obj.proxied)
    }

    results.push(rec)
  }

  return results
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

export function parseCsvRecords(text: string): ParsedImportRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (!lines.length) return []

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase())
  const nameIdx = header.findIndex((h) => h.includes('name') || h.includes('名称') || h.includes('主机'))
  const typeIdx = header.findIndex((h) => h.includes('type') || h.includes('类型'))
  const valIdx = header.findIndex(
    (h) => h.includes('value') || h.includes('值') || h.includes('content') || h.includes('内容')
  )
  const ttlIdx = header.findIndex((h) => h.includes('ttl'))
  const lineIdx = header.findIndex((h) => h.includes('line') || h.includes('线路'))
  const proxiedIdx = header.findIndex((h) => h.includes('proxied') || h.includes('代理') || h.includes('cdn'))
  const remarkIdx = header.findIndex((h) => h.includes('remark') || h.includes('comment') || h.includes('备注'))
  const priorityIdx = header.findIndex((h) => h.includes('priority') || h.includes('mx') || h.includes('优先级'))

  const results: ParsedImportRecord[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    if (!cells.length) continue

    const name = (nameIdx >= 0 ? cells[nameIdx] : cells[0]) || '@'
    const type = ((typeIdx >= 0 ? cells[typeIdx] : cells[1]) || 'A').toUpperCase()
    const value = (valIdx >= 0 ? cells[valIdx] : cells[2]) || ''
    if (!value) continue

    const rec: ParsedImportRecord = { name, type, value }
    if (ttlIdx >= 0 && cells[ttlIdx]) {
      const ttl = Number(cells[ttlIdx])
      if (Number.isFinite(ttl) && ttl > 0) rec.ttl = ttl
    }
    if (lineIdx >= 0 && cells[lineIdx]) rec.line = cells[lineIdx]
    if (proxiedIdx >= 0 && cells[proxiedIdx])
      rec.proxied = ['true', '1', 'yes', '是'].includes(cells[proxiedIdx].toLowerCase())
    if (remarkIdx >= 0 && cells[remarkIdx]) rec.remark = cells[remarkIdx]
    if (priorityIdx >= 0 && cells[priorityIdx]) {
      const p = Number(cells[priorityIdx])
      if (Number.isFinite(p)) rec.priority = p
    }

    results.push(rec)
  }

  return results
}

export function parseZoneRecords(text: string, currentZone = ''): ParsedImportRecord[] {
  const lines = text.split(/\r?\n/)
  const results: ParsedImportRecord[] = []
  let origin = currentZone.toLowerCase().replace(/\.$/, '')
  let defaultTtl = 600

  const validTypes = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR'])

  for (const rawLine of lines) {
    const cleanLine = rawLine.split(';')[0].split('#')[0].trim()
    if (!cleanLine) continue

    if (cleanLine.startsWith('$ORIGIN')) {
      const parts = cleanLine.split(/\s+/)
      if (parts[1]) origin = parts[1].replace(/\.$/, '').toLowerCase()
      continue
    }

    if (cleanLine.startsWith('$TTL')) {
      const parts = cleanLine.split(/\s+/)
      const t = Number(parts[1])
      if (Number.isFinite(t) && t > 0) defaultTtl = t
      continue
    }

    const tokens = cleanLine.split(/\s+/)
    if (tokens.length < 3) continue

    let name = tokens[0]
    let remaining = tokens.slice(1)

    if (origin && name.endsWith(`.${origin}.`)) {
      name = name.slice(0, -(origin.length + 2)) || '@'
    } else if (origin && name === `${origin}.`) {
      name = '@'
    } else if (name.endsWith('.')) {
      name = name.slice(0, -1)
    }

    let ttl = defaultTtl
    if (remaining.length > 0 && /^\d+$/.test(remaining[0])) {
      ttl = Number(remaining[0])
      remaining = remaining.slice(1)
    }

    if (remaining.length > 0 && remaining[0].toUpperCase() === 'IN') {
      remaining = remaining.slice(1)
    }

    if (remaining.length < 2) continue

    const type = remaining[0].toUpperCase()
    if (!validTypes.has(type)) continue
    remaining = remaining.slice(1)

    let priority: number | undefined
    if (type === 'MX' && remaining.length >= 2 && /^\d+$/.test(remaining[0])) {
      priority = Number(remaining[0])
      remaining = remaining.slice(1)
    }

    let value = remaining.join(' ').trim()
    if (type === 'TXT' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }

    if (value) {
      results.push({
        name: name || '@',
        type,
        value,
        ttl,
        priority,
      })
    }
  }

  return results
}

export function parseDnsFile(content: string, filename: string, zoneName = ''): ParsedImportRecord[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json')) {
    return parseJsonRecords(content)
  }
  if (lower.endsWith('.csv')) {
    return parseCsvRecords(content)
  }
  if (lower.endsWith('.zone') || lower.endsWith('.txt') || lower.endsWith('.bind')) {
    return parseZoneRecords(content, zoneName)
  }

  // Fallback heuristic detection
  const trimmed = content.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonRecords(content)
  }
  if (trimmed.includes('$ORIGIN') || trimmed.includes('$TTL') || /\bIN\s+(?:A|CNAME|TXT|AAAA|MX)\b/i.test(trimmed)) {
    return parseZoneRecords(content, zoneName)
  }
  return parseCsvRecords(content)
}
