import type { ReconcileResult } from '@/features/sync/model/types'

/** 单条写入结果：status 与后端 dns-writer 的闭合联合一致（含 failed） */
export type RepairOutcome = ReconcileResult['results'][number]

type RepairNotice = {
  /** success=没有失败项；error=存在失败项（包括全部失败） */
  tone: 'success' | 'error'
  message: string
}

/**
 * 一键修复结果提示。
 * failed 必须单独统计：否则 created/updated/skipped 全为 0 时会退化成
 * 「派生记录均无需变更」，把整批失败误报成「没有需要变更的派生记录」。
 */
export function buildRepairNotice(results: RepairOutcome[]): RepairNotice {
  const changed = results.filter((item) => item.status === 'created' || item.status === 'updated').length
  const skipped = results.filter((item) => item.status === 'skipped').length
  const failures = results.filter((item) => item.status === 'failed')
  const firstError = String(failures[0]?.error || '').trim()

  if (failures.length) {
    const parts = [`已修复 ${changed} 条`]
    if (skipped) parts.push(`跳过 ${skipped} 条（归属冲突）`)
    parts.push(`${failures.length} 条失败`)
    return { tone: 'error', message: `${parts.join('，')}${firstError ? `；首条原因：${firstError}` : ''}` }
  }

  if (changed === 0 && skipped === 0) return { tone: 'success', message: '派生记录均无需变更' }
  return {
    tone: 'success',
    message: `已修复 ${changed} 条${skipped ? `，跳过 ${skipped} 条（归属冲突）` : ''}`,
  }
}
