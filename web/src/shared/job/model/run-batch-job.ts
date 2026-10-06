import { toast } from '../../lib/toast'
import { formatFailedJobItem, showBatchFailures } from '../lib/batch-results'
import { useJobProgress, extractJobId } from './use-job-progress'
import type { CreateJobResult, JobLike } from './types'

/**
 * Create a batch job → poll → show failures (with optional retry) → optional reload.
 * Shared by DNS / SaaS / EdgeOne list pages.
 */
export async function runBatchJob(options: {
  label: string
  create: () => Promise<CreateJobResult>
  /** 详情缺失（空体/null）如实返回 null：类型单一，调用点不需要二次断言成 JobLike */
  fetchJob: (jobId: string) => Promise<JobLike | null>
  retry?: (jobId: string) => Promise<unknown>
  onDone?: () => void | Promise<void>
  clearSelection?: () => void
  failureUnit?: string
  jobProgress?: ReturnType<typeof useJobProgress>
}): Promise<JobLike | null> {
  const jobProgress = options.jobProgress || useJobProgress()
  if (jobProgress.running.value) {
    toast.warning('已有批量任务在执行，请等待完成后再试')
    return null
  }
  const owner = jobProgress.begin(`${options.label}创建中`)
  let created: CreateJobResult
  try {
    created = await options.create()
  } catch (error) {
    jobProgress.release(owner)
    throw error
  }
  if (!jobProgress.owns(owner)) return null
  const jobId = extractJobId(created.data)
  if (!jobId) {
    jobProgress.release(owner)
    throw new Error(`${options.label}任务创建失败`)
  }

  const poll = () => jobProgress.pollJob(jobId, { label: options.label, fetchJob: options.fetchJob }, owner)

  const job = await poll()
  if (!jobProgress.owns(owner) || !job) return null
  const owns = () => jobProgress.owns(owner)
  return finishBatchJob({
    job,
    label: options.label,
    jobProgress,
    isActive: owns,
    onRetry: options.retry
      ? async () => {
          if (!owns()) return null
          await options.retry!(jobId)
          if (!owns()) return null
          return poll()
        }
      : undefined,
    failureUnit: options.failureUnit,
    clearSelection: options.clearSelection,
    onDone: options.onDone,
  })
}

/**
 * 批量任务收尾：失败项格式化 → 失败弹窗（可重试）→ 成功提示 → 清选 / 收尾刷新。
 * runBatchJob（新建任务）与「恢复后端进行中任务」两条路径共用：两者只在作用域守卫与重试闭包上
 * 不同，收尾语义必须一致，否则两处会各自漂移。
 */
export async function finishBatchJob(options: {
  job: JobLike
  label: string
  jobProgress: ReturnType<typeof useJobProgress>
  /** 作用域守卫：失效后不再弹重试结果、不清选、不刷新 */
  isActive: () => boolean
  /** 重试闭包由调用点提供：自行完成「重试接口 + 重新轮询」，返回重试后的任务详情 */
  onRetry?: () => Promise<JobLike | null>
  failureUnit?: string
  /** 成功提示兜底文案：优先用任务自身的 message，其次用这里，最后 `${label}完成` */
  successText?: string
  clearSelection?: () => void
  onDone?: () => void | Promise<void>
}): Promise<JobLike | null> {
  const failed = options.jobProgress.failedItems(options.job).map((item) => formatFailedJobItem(item))
  if (failed.length) {
    await showBatchFailures(options.job.message || `${options.label}完成`, failed, options.failureUnit || '条', {
      onRetry: options.onRetry,
      isActive: options.isActive,
    })
  } else {
    toast.success(options.job.message || options.successText || `${options.label}完成`)
  }
  if (!options.isActive()) return null
  options.clearSelection?.()
  if (!options.isActive()) return null
  await options.onDone?.()
  if (!options.isActive()) return null
  return options.job
}
