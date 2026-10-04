import type { DnsRecord } from '../model/types'
import type { ParsedImportRecord } from './record-import'

type ImportOverwrite = { incoming: ParsedImportRecord; existing: DnsRecord }

/** 用户确认后的导入计划：批量新增 + 逐条覆盖 */
export type ImportPlan = {
  added: ParsedImportRecord[]
  overwritten: ImportOverwrite[]
}

type ImportPreview = {
  /** 本地不存在同名同类型：批量创建 */
  added: ParsedImportRecord[]
  /** 本地已存在同名同类型但值不同：经用户确认后覆盖 */
  overwritten: ImportOverwrite[]
  /** 与本地完全一致（同名同类型同值）：跳过 */
  duplicates: ParsedImportRecord[]
}

const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()
const sameType = (left: string, right: string) => left.trim().toUpperCase() === right.trim().toUpperCase()

/** 导入前 diff：让用户在写入前看到「新增 / 覆盖 / 重复」的确切数量与明细（F4）。 */
export function buildImportPreview(parsed: ParsedImportRecord[], existing: DnsRecord[]): ImportPreview {
  const preview: ImportPreview = { added: [], overwritten: [], duplicates: [] }
  // 同一条 existing 记录只能被覆盖一次：多条同名同类型导入若都指向同一 ID，
  // 逐条 PUT 只会留下最后一条值，其余必须按新增处理，否则静默丢数据。
  const claimedIds = new Set<string>()
  for (const incoming of parsed) {
    const candidates = existing.filter(
      (record) =>
        sameName(String(record.name || ''), incoming.name) && sameType(String(record.type || ''), incoming.type)
    )
    if (candidates.some((record) => String(record.value ?? record.content ?? '') === incoming.value)) {
      preview.duplicates.push(incoming)
      continue
    }
    const target = candidates.find((record) => {
      const id = String(record.id || '').trim()
      return !!id && !claimedIds.has(id)
    })
    if (!target) {
      preview.added.push(incoming)
      continue
    }
    claimedIds.add(String(target.id || '').trim())
    preview.overwritten.push({ incoming, existing: target })
  }
  return preview
}
