/** DNS 批量操作：统一指令归一化（厂商请求体映射由 domains 侧适配器负责） */
import type { DnsRecordStatus } from '../../core/contracts/dns-record.port.js'

export type BatchRecordInput = {
  id?: string
  name?: string
  type?: string
  value?: string
  ttl?: number
  line?: string
  record_line_id?: string
  priority?: number
  remark?: string
  proxied?: boolean
  status?: DnsRecordStatus
  weight?: number
}

type BatchRecordPatch = Partial<
  Pick<
    BatchRecordInput,
    'value' | 'ttl' | 'line' | 'record_line_id' | 'priority' | 'remark' | 'proxied' | 'status' | 'weight'
  >
>

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
