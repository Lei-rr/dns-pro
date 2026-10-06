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
  /** 任务已创建、开始轮询前（适合关弹窗） */
  onStart?: () => void | Promise<void>
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

  await options.onStart?.()

  const poll = () => jobProgress.pollJob(jobId, { label: options.label, fetchJob: options.fetchJob }, owner)

  const job = await poll()
  if (!jobProgress.owns(owner) || !job) return null
  const failed = jobProgress.failedItems(job).map((item) => formatFailedJobItem(item))
  if (failed.length) {
    await showBatchFailures(job?.message || `${options.label}完成`, failed, options.failureUnit || '条', {
      onRetry: options.retry
        ? async () => {
            if (!jobProgress.owns(owner)) return null
            await options.retry!(jobId)
            if (!jobProgress.owns(owner)) return null
            return poll()
          }
        : undefined,
      isActive: () => jobProgress.owns(owner),
    })
  } else {
    toast.success(job?.message || `${options.label}完成`)
  }
  if (!jobProgress.owns(owner)) return null
  options.clearSelection?.()
  if (!jobProgress.owns(owner)) return null
  await options.onDone?.()
  if (!jobProgress.owns(owner)) return null
  return job
}
