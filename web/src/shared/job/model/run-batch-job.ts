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
  fetchJob: (jobId: string) => Promise<JobLike | Record<string, unknown>>
  retry?: (jobId: string) => Promise<unknown>
  /** 任务已创建、开始轮询前（适合关弹窗） */
  onStart?: () => void | Promise<void>
  onDone?: () => void | Promise<void>
  clearSelection?: () => void
  failureUnit?: string
  jobProgress?: ReturnType<typeof useJobProgress>
}): Promise<JobLike | null> {
  const jobProgress = options.jobProgress || useJobProgress()
  if (jobProgress.running.value) return null
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

  const poll = () =>
    jobProgress.pollJob(
      jobId,
      {
        label: options.label,
        fetchJob: async (id) => (await options.fetchJob(id)) as JobLike,
      },
      owner
    )

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
  return (job as JobLike) || null
}
