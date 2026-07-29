/** DNS batch record field normalization + provider body builders (no I/O). */

export type BatchRecordInput = {
  id?: string
  name?: string
  type?: string
  value?: string
  content?: string
  ttl?: number | string
  line?: string
  record_line?: string
  record_line_id?: string
  mx?: number | string
  priority?: number | string
  remark?: string
  comment?: string
  proxied?: boolean
  subdomain?: string
  status?: string
  weight?: number | string
}

export type BatchRecordPatch = Partial<Pick<
  BatchRecordInput,
  'value' | 'content' | 'ttl' | 'line' | 'record_line' | 'record_line_id' | 'mx' | 'priority' | 'remark' | 'comment' | 'proxied' | 'status' | 'weight'
>>

export type ProviderRecordBody = Record<string, unknown>

function cloudflareFqdn(nameRaw: string, zone: string): string {
  if (nameRaw === '@') return zone
  const lower = nameRaw.toLowerCase()
  const zoneLower = zone.toLowerCase()
  return lower.endsWith('.' + zoneLower) ? nameRaw : `${nameRaw}.${zone}`
}

export function buildCreateBody(
  providerType: string,
  zone: string,
  item: Record<string, unknown>,
): Record<string, unknown> {
  if (providerType === 'cloudflare') {
    const nameRaw = String(item.name || '@')
    const body: Record<string, unknown> = {
      type: String(item.type || 'A').toUpperCase(),
      name: cloudflareFqdn(nameRaw, zone),
      content: String(item.value ?? item.content ?? ''),
      ttl: Number(item.ttl ?? 1) || 1,
    }
    if (item.priority !== undefined && item.priority !== '') body.priority = Number(item.priority)
    if (item.comment !== undefined || item.remark !== undefined) {
      body.comment = String(item.comment ?? item.remark ?? '')
    }
    if (item.proxied !== undefined) body.proxied = Boolean(item.proxied)
    return body
  }

  const body: Record<string, unknown> = {
    record_type: String(item.type || 'A').toUpperCase(),
    record_line: String(item.line || item.record_line || '默认'),
    value: String(item.value ?? item.content ?? ''),
    subdomain: String(item.name || item.subdomain || '@'),
  }
  if (item.ttl !== undefined && item.ttl !== '') body.ttl = Number(item.ttl)
  if (item.priority !== undefined && item.priority !== '') body.mx = Number(item.priority)
  else if (item.mx !== undefined && item.mx !== '') body.mx = Number(item.mx)
  if (item.remark !== undefined || item.comment !== undefined) {
    body.remark = String(item.remark ?? item.comment ?? '')
  }
  if (item.record_line_id !== undefined && item.record_line_id !== '') {
    body.record_line_id = String(item.record_line_id)
  }
  if (item.weight !== undefined && item.weight !== '') body.weight = Number(item.weight)
  return body
}

/**
 * Merge per-record snapshot + shared patch into provider update payload.
 * DNSPod / Cloudflare update APIs require full record fields.
 */
export function buildUpdateBody(
  providerType: string,
  zone: string,
  item: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const pick = (key: string, ...aliases: string[]) => {
    for (const k of [key, ...aliases]) {
      if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') return patch[k]
    }
    for (const k of [key, ...aliases]) {
      if (item[k] !== undefined && item[k] !== null && item[k] !== '') return item[k]
    }
    return undefined
  }

  if (providerType === 'cloudflare') {
    const nameRaw = String(pick('name', 'subdomain') ?? '@')
    const body: Record<string, unknown> = {
      type: String(pick('type', 'record_type') ?? 'A').toUpperCase(),
      name: cloudflareFqdn(nameRaw, zone),
      content: String(pick('value', 'content') ?? ''),
      ttl: Number(pick('ttl') ?? 1) || 1,
    }
    const priority = pick('priority', 'mx')
    if (priority !== undefined) body.priority = Number(priority)
    const remark = pick('remark', 'comment')
    if (remark !== undefined) body.comment = String(remark)
    if (patch.proxied !== undefined) body.proxied = Boolean(patch.proxied)
    else if (item.proxied !== undefined) body.proxied = Boolean(item.proxied)
    return body
  }

  const body: Record<string, unknown> = {
    record_type: String(pick('type', 'record_type') ?? 'A').toUpperCase(),
    record_line: String(pick('line', 'record_line') ?? '默认') || '默认',
    value: String(pick('value', 'content') ?? ''),
    subdomain: String(pick('subdomain', 'name') ?? '@') || '@',
  }
  const ttl = pick('ttl')
  if (ttl !== undefined && ttl !== '') body.ttl = Number(ttl)
  const mx = pick('mx', 'priority')
  if (mx !== undefined && mx !== '') body.mx = Number(mx)
  const remark = pick('remark', 'comment')
  if (remark !== undefined) body.remark = String(remark)
  const lineId = pick('record_line_id')
  if (lineId !== undefined) body.record_line_id = String(lineId)
  const status = pick('status', 'record_status')
  if (status !== undefined) body.status = String(status).toUpperCase()
  const weight = pick('weight')
  if (weight !== undefined && weight !== '') body.weight = Number(weight)
  return body
}

export function normalizeCreateRecords(
  records: BatchRecordInput[],
): Array<BatchRecordInput & { item_key: string }> {
  const seen = new Set<string>()
  return (records || [])
    .map((item) => ({
      ...item,
      name: String(item.name || item.subdomain || '').trim(),
      type: String(item.type || '').trim().toUpperCase(),
      value:
        item.value !== undefined
          ? String(item.value)
          : item.content !== undefined
            ? String(item.content)
            : '',
    }))
    .filter((item) => item.name && item.type && item.value)
    .flatMap((item) => {
      const key = `${item.name}\u0000${item.type}\u0000${item.line || item.record_line || ''}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ ...item, item_key: key }]
    })
}

export function normalizeRecords(records: BatchRecordInput[]): BatchRecordInput[] {
  const seen = new Set<string>()
  return (records || [])
    .map((item) => ({
      ...item,
      id: String(item.id || '').trim(),
      name: String(item.name || '').trim(),
      type: String(item.type || '').trim(),
      value:
        item.value !== undefined
          ? String(item.value)
          : item.content !== undefined
            ? String(item.content)
            : '',
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
}

export function normalizePatch(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const raw = patch && typeof patch === 'object' ? patch : {}

  const setString = (key: string, ...aliases: string[]) => {
    for (const k of [key, ...aliases]) {
      if (raw[k] === undefined || raw[k] === null) continue
      const text = String(raw[k]).trim()
      if (text === '') continue
      out[key] = text
      return
    }
  }
  const setNumber = (key: string, ...aliases: string[]) => {
    for (const k of [key, ...aliases]) {
      if (raw[k] === undefined || raw[k] === null || raw[k] === '') continue
      const num = Number(raw[k])
      if (!Number.isFinite(num)) continue
      out[key] = num
      return
    }
  }

  setString('value', 'content')
  setNumber('ttl')
  setString('line', 'record_line')
  setString('record_line_id')
  setString('remark', 'comment')
  setNumber('mx', 'priority')
  setNumber('priority', 'mx')
  setString('status')
  setNumber('weight')
  if (raw.proxied !== undefined && raw.proxied !== null && raw.proxied !== '') {
    out.proxied = raw.proxied === true || raw.proxied === 1 || raw.proxied === '1' || raw.proxied === 'true'
  }
  return out
}
