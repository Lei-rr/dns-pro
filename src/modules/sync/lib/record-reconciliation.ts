import type { SyncRecord } from '../types.js'

export type SyncResult = Record<string, unknown>

export async function withSyncPurpose(
  record: SyncRecord,
  result: Promise<SyncResult>,
): Promise<SyncResult> {
  return { purpose: record.purpose, ...(await result) }
}

/**
 * Select records removed by an update and execute cleanup once per stable identity.
 * Value changes intentionally keep their identity so provider sync can update in place.
 */
export async function deleteRemovedSyncRecords<T extends SyncRecord>(
  beforeRecords: SyncRecord[],
  afterRecords: T[],
  identity: (record: SyncRecord) => string,
  remove: (record: SyncRecord) => Promise<SyncResult>,
): Promise<SyncResult[]> {
  const retained = new Set(afterRecords.map(identity))
  const seen = new Set<string>()
  const deleted: SyncResult[] = []

  for (const record of beforeRecords) {
    const key = identity(record)
    if (key === '' || seen.has(key) || retained.has(key)) continue
    seen.add(key)
    deleted.push(await withSyncPurpose(record, remove(record)))
  }
  return deleted
}

export function syncRecordIdentity(record: SyncRecord, line = ''): string {
  const type = String(record.type ?? '').toUpperCase().trim()
  const name = String(record.name ?? '').toLowerCase().replace(/\.$/, '').trim()
  const recordLine = String(record.line ?? line).trim()
  if (type === '' || name === '') return ''
  return [type, name, recordLine].join('|')
}
