/** Unified DNS batch commands + provider request builders (no I/O). */

export type BatchRecordInput = {
  id?: string
  name?: string
  type?: string
  value?: string
  ttl?: number | string
  line?: string
  record_line_id?: string
  priority?: number | string
  remark?: string
  proxied?: boolean
  status?: string
  weight?: number | string
}

export type BatchRecordPatch = Partial<
  Pick<
    BatchRecordInput,
    'value' | 'ttl' | 'line' | 'record_line_id' | 'priority' | 'remark' | 'proxied' | 'status' | 'weight'
  >
>

function cloudflareFqdn(nameRaw: string, zone: string): string {
  if (nameRaw === '@') return zone
  const lower = nameRaw.toLowerCase()
  const zoneLower = zone.toLowerCase()
  return lower.endsWith('.' + zoneLower) ? nameRaw : `${nameRaw}.${zone}`
}

export function buildCreateBody(
  providerType: string,
  zone: string,
  item: Record<string, unknown>
): Record<string, unknown> {
  if (providerType === 'cloudflare') {
    const body: Record<string, unknown> = {
      type: String(item.type || 'A').toUpperCase(),
      name: cloudflareFqdn(String(item.name || '@'), zone),
      content: String(item.value ?? ''),
      ttl: Number(item.ttl ?? 1) || 1,
    }
    if (item.priority !== undefined && item.priority !== '') body.priority = Number(item.priority)
    if (item.remark !== undefined) body.comment = String(item.remark)
    if (item.proxied !== undefined) body.proxied = Boolean(item.proxied)
    return body
  }

  const body: Record<string, unknown> = {
    record_type: String(item.type || 'A').toUpperCase(),
    record_line: String(item.line || '默认'),
    value: String(item.value ?? ''),
    subdomain: String(item.name || '@'),
  }
  if (item.ttl !== undefined && item.ttl !== '') body.ttl = Number(item.ttl)
  if (item.priority !== undefined && item.priority !== '') body.mx = Number(item.priority)
  if (item.remark !== undefined) body.remark = String(item.remark)
  if (item.record_line_id !== undefined && item.record_line_id !== '') {
    body.record_line_id = String(item.record_line_id)
  }
  if (item.status !== undefined && item.status !== '') body.status = String(item.status).toUpperCase()
  if (item.weight !== undefined && item.weight !== '') body.weight = Number(item.weight)
  return body
}

/** Merge a unified record snapshot + unified patch into the provider's required full update body. */
export function buildUpdateBody(
  providerType: string,
  zone: string,
  item: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const pick = (key: string) => {
    const patched = patch[key]
    if (patched !== undefined && patched !== null && patched !== '') return patched
    const current = item[key]
    return current !== undefined && current !== null && current !== '' ? current : undefined
  }

  if (providerType === 'cloudflare') {
    const body: Record<string, unknown> = {
      type: String(pick('type') ?? 'A').toUpperCase(),
      name: cloudflareFqdn(String(pick('name') ?? '@'), zone),
      content: String(pick('value') ?? ''),
      ttl: Number(pick('ttl') ?? 1) || 1,
    }
    const priority = pick('priority')
    if (priority !== undefined) body.priority = Number(priority)
    const remark = pick('remark')
    if (remark !== undefined) body.comment = String(remark)
    const proxied = pick('proxied')
    if (proxied !== undefined) body.proxied = Boolean(proxied)
    return body
  }

  const body: Record<string, unknown> = {
    record_type: String(pick('type') ?? 'A').toUpperCase(),
    record_line: String(pick('line') ?? '默认') || '默认',
    value: String(pick('value') ?? ''),
    subdomain: String(pick('name') ?? '@') || '@',
  }
  const ttl = pick('ttl')
  if (ttl !== undefined) body.ttl = Number(ttl)
  const priority = pick('priority')
  if (priority !== undefined) body.mx = Number(priority)
  const remark = pick('remark')
  if (remark !== undefined) body.remark = String(remark)
  const lineId = pick('record_line_id')
  if (lineId !== undefined) body.record_line_id = String(lineId)
  const status = pick('status')
  if (status !== undefined) body.status = String(status).toUpperCase()
  const weight = pick('weight')
  if (weight !== undefined) body.weight = Number(weight)
  return body
}

export function normalizeCreateRecords(records: BatchRecordInput[]): Array<BatchRecordInput & { item_key: string }> {
  const seen = new Set<string>()
  return records
    .map((item) => ({
      ...item,
      name: String(item.name || '').trim(),
      type: String(item.type || '')
        .trim()
        .toUpperCase(),
      value: item.value === undefined ? '' : String(item.value),
    }))
    .filter((item) => item.name && item.type && item.value)
    .flatMap((item) => {
      const key = `${item.name}\u0000${item.type}\u0000${item.line || ''}\u0000${item.value}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ ...item, item_key: key }]
    })
}

export function normalizeRecords(records: BatchRecordInput[]): BatchRecordInput[] {
  const seen = new Set<string>()
  return records
    .map((item) => ({
      ...item,
      id: String(item.id || '').trim(),
      name: String(item.name || '').trim(),
      type: String(item.type || '').trim(),
      value: item.value === undefined ? '' : String(item.value),
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
}

export function normalizePatch(patch: BatchRecordPatch = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const setString = (key: keyof BatchRecordPatch) => {
    const value = patch[key]
    if (value === undefined || value === null) return
    const normalized = String(value).trim()
    if (normalized) out[key] = normalized
  }
  const setNumber = (key: keyof BatchRecordPatch) => {
    const value = patch[key]
    if (value === undefined || value === null || value === '') return
    const normalized = Number(value)
    if (Number.isFinite(normalized)) out[key] = normalized
  }

  setString('value')
  setNumber('ttl')
  setString('line')
  setString('record_line_id')
  setString('remark')
  setNumber('priority')
  setString('status')
  setNumber('weight')
  if (patch.proxied !== undefined) out.proxied = patch.proxied
  return out
}
