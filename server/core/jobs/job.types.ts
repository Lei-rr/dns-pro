/** 任务类型定义 */
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
 * 互斥判定输入：只描述「哪些作业类型 + 哪些底层资源」，判定实现只有 job-registry.jobConflictsWith 一份。
 * 创建/重试从 payload 取键，面板反查（BatchJobKind.active）现算键，两处构造出的都是本类型，
 * 因此不存在「两套口径」：同一组资源事实必然得到同一结论。
 */
export type JobLock = {
  /** 互斥范围：会写同一底层资源的全部任务类型 */
  types: readonly string[]
  /** 唯一主判据：本次会写入的底层资源键，与活跃作业的 resource_keys 相交即互斥 */
  resourceKeys?: readonly string[]
  /** 降级判据：作业没有 resource_keys（早于资源键机制的记录）时的 payload 同名字段相等 */
  scope?: Record<string, string>
  message?: string
}

type JobItemSummary = Pick<JobRecord, 'done' | 'success' | 'failed' | 'skipped'>

/**
 * 仅用于执行期恢复的内部快照字段。
 * 已完成任务不可能再重试，内存中剥离以控制体积；失败任务保留（重试需要更新前的 DNS 快照）。
 * 同一份清单同时用于 job.service 的内存剥离与 batch-job 的对外隐藏，避免两处漂移。
 */
export const EXECUTION_SNAPSHOT_FIELDS = ['dns_before_records', 'cleanup_recipe'] as const

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
