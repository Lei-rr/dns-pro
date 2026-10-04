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

function parseJsonRecords(text: string): ParsedImportRecord[] {
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

/** 解析整段 CSV：引号内的逗号、换行、转义引号都按 RFC4180 处理 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (!inQuotes && char === ',') {
      cells.push(current.trim())
      current = ''
      continue
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++
      cells.push(current.trim())
      current = ''
      if (cells.some((cell) => cell !== '')) rows.push(cells)
      cells = []
      continue
    }
    current += char
  }
  cells.push(current.trim())
  if (cells.some((cell) => cell !== '')) rows.push(cells)
  return rows
}

const CSV_HEADER_KEYS = ['name', 'type', 'value', 'content', 'ttl', 'line', 'proxied', 'remark', 'comment', 'mx']

function isCsvHeader(cells: string[]): boolean {
  return cells.some((cell) => CSV_HEADER_KEYS.some((key) => cell.toLowerCase().includes(key)))
}

function parseCsvRecords(text: string): ParsedImportRecord[] {
  const rows = parseCsvRows(text)
  if (!rows.length) return []

  const first = rows[0] as string[]
  const hasHeader = isCsvHeader(first)
  const header = hasHeader ? first.map((h) => h.toLowerCase()) : []
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
  // 无表头时首行即数据，不能吞掉
  for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
    const cells = rows[i] as string[]
    if (!cells.length) continue

    const name = (nameIdx >= 0 ? cells[nameIdx] : cells[0]) || '@'
    const type = ((typeIdx >= 0 ? cells[typeIdx] : cells[1]) || 'A').trim().toUpperCase()
    const value = (valIdx >= 0 ? cells[valIdx] : cells[2]) || ''
    if (!value) continue

    const rec: ParsedImportRecord = { name: name.trim() || '@', type, value }
    if (ttlIdx >= 0 && cells[ttlIdx]) {
      const ttl = parseTtl(cells[ttlIdx] as string)
      if (ttl !== undefined) rec.ttl = ttl
    }
    if (lineIdx >= 0 && cells[lineIdx]) rec.line = cells[lineIdx]
    if (remarkIdx >= 0 && cells[remarkIdx]) rec.remark = cells[remarkIdx]
    if (priorityIdx >= 0 && cells[priorityIdx]) {
      const p = Number(cells[priorityIdx])
      if (Number.isFinite(p)) rec.priority = p
    }
    if (proxiedIdx >= 0 && cells[proxiedIdx]) {
      rec.proxied = ['true', '1', 'yes', '是', 'on'].includes((cells[proxiedIdx] as string).toLowerCase())
    }

    results.push(rec)
  }

  return results
}

/** TTL 支持 1h / 30m / 1d / 1w 等写法 */
function parseTtl(value: string): number | undefined {
  const text = value.trim().toLowerCase()
  if (text === '') return undefined
  if (/^\d+$/.test(text)) {
    const ttl = Number(text)
    return ttl > 0 ? ttl : undefined
  }
  const match = /^(\d+)\s*([smhdw])$/.exec(text)
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[match[2] as 's' | 'm' | 'h' | 'd' | 'w']
  return amount > 0 ? amount * unit : undefined
}

/** 去掉引号外的注释（`;` 与 `#`），引号内的分号必须保留（如 TXT "v=DMARC1; p=none"） */
function stripZoneComment(line: string): string {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && (char === ';' || char === '#')) return line.slice(0, i)
  }
  return line
}

/** 合并 `( ... )` 续行，并把续行内容接到上一行 */
function joinZoneLines(text: string): string[] {
  const joined: string[] = []
  let buffer = ''
  let depth = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = stripZoneComment(raw)
    buffer = buffer === '' ? line : `${buffer} ${line.trim()}`
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length
    if (depth > 0) continue
    joined.push(buffer.replace(/[()]/g, ' '))
    buffer = ''
  }
  if (buffer.trim()) joined.push(buffer)
  return joined
}

function parseZoneRecords(text: string, currentZone = ''): ParsedImportRecord[] {
  const results: ParsedImportRecord[] = []
  let origin = currentZone.toLowerCase().replace(/\.$/, '')
  let defaultTtl = 600
  let lastOwner = ''

  const validTypes = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR'])

  for (const rawLine of joinZoneLines(text)) {
    const cleanLine = rawLine.trim()
    if (!cleanLine) continue
    // RFC1035：以空白开头的行沿用上一条记录的 owner
    const inheritsOwner = /^\s/.test(rawLine) && lastOwner !== ''

    if (cleanLine.startsWith('$ORIGIN')) {
      const parts = cleanLine.split(/\s+/)
      if (parts[1]) origin = (parts[1] as string).replace(/\.$/, '').toLowerCase()
      continue
    }

    if (cleanLine.startsWith('$TTL')) {
      const parts = cleanLine.split(/\s+/)
      const ttl = parseTtl(parts[1] ?? '')
      if (ttl !== undefined) defaultTtl = ttl
      continue
    }

    const tokens = cleanLine.split(/\s+/)
    let name: string
    let remaining: string[]

    if (inheritsOwner) {
      name = lastOwner
      remaining = tokens
    } else {
      if (tokens.length < 3) continue
      name = tokens[0] as string
      remaining = tokens.slice(1)
      lastOwner = name
    }

    if (origin && name.toLowerCase() === `${origin}.`) {
      name = '@'
    } else if (origin && name.toLowerCase().endsWith(`.${origin}.`)) {
      name = name.slice(0, -(origin.length + 2)) || '@'
    } else if (name.endsWith('.')) {
      name = name.slice(0, -1)
    }

    let ttl = defaultTtl
    if (remaining.length > 0) {
      const parsedTtl = parseTtl(remaining[0] as string)
      if (parsedTtl !== undefined) {
        ttl = parsedTtl
        remaining = remaining.slice(1)
      }
    }

    if (remaining.length > 0 && (remaining[0] as string).toUpperCase() === 'IN') {
      remaining = remaining.slice(1)
    }

    if (remaining.length < 2) continue

    const type = (remaining[0] as string).toUpperCase()
    if (!validTypes.has(type)) continue
    remaining = remaining.slice(1)

    let priority: number | undefined
    if (type === 'MX' && remaining.length >= 2 && /^\d+$/.test(remaining[0] as string)) {
      priority = Number(remaining[0])
      remaining = remaining.slice(1)
    }

    let value = remaining.join(' ').trim()
    // 去掉包裹引号（多段引号拼接按 RFC1035 直接相连）
    if (value.includes('"')) {
      value = (value.match(/"[^"]*"/g) ?? [value]).map((part) => part.replace(/^"|"$/g, '')).join('')
    }

    if (!value) continue

    const rec: ParsedImportRecord = { name: name || '@', type, value, ttl }
    if (priority !== undefined) rec.priority = priority
    results.push(rec)
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
