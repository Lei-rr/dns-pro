/** 持久化任务类型定义 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

export type JobItem = Record<string, unknown>

export type JobRecord = {
  id: string
  type: string
  status: JobStatus
  total: number
  done: number
  success: number
  failed: number
  skipped: number
  current?: string | number
  payload: Record<string, unknown>
  items: JobItem[]
  created_at: number
  updated_at: number
  finished_at?: number
  message?: string
}

/**
 * 互斥锁：
 * - 提供 resourceKeys 时，只要 types 中任一活跃任务的资源键有交集就拒绝（跨工作流共享底层资源）
 * - 否则退化为 scope 相等判定
 */
export type JobLock = {
  types: readonly string[]
  scope?: Record<string, string>
  resourceKeys?: string[]
  message?: string
}

type JobItemSummary = Pick<JobRecord, 'done' | 'success' | 'failed' | 'skipped'>

/** 按条目状态统计进度 */
export function summarizeJobItems(items: JobItem[]): JobItemSummary {
  let success = 0
  let failed = 0
  let skipped = 0
  for (const item of items) {
    if (item.status === 'success') success++
    else if (item.status === 'failed') failed++
    else if (item.status === 'skipped') skipped++
  }
  return { done: success + failed + skipped, success, failed, skipped }
}
