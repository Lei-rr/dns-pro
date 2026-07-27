import { toast } from '@/shared/lib/toast'
import {
  formatFailedJobItem,
  showBatchFailures,
  type JobLike,
} from '@/shared/lib/batch'
import { useJobProgress, extractJobId, type JobLike as ProgressJob } from '@/shared/lib/job-progress'

type CreateResult = { data?: unknown }

/**
 * Create a provider batch job → poll → show failures (with optional retry) → optional reload.
 * Shared by DNS / SaaS / EdgeOne list pages.
 */
export async function runProviderBatch(options: {
  label: string
  create: () => Promise<CreateResult>
  fetchJob: (jobId: string) => Promise<ProgressJob | Record<string, unknown>>
  retry?: (jobId: string) => Promise<unknown>
  /** 任务已创建、开始轮询前（适合关弹窗） */
  onStart?: () => void | Promise<void>
  onDone?: () => void | Promise<void>
  clearSelection?: () => void
  failureUnit?: string
  jobProgress?: ReturnType<typeof useJobProgress>
}): Promise<JobLike | null> {
  const jobProgress = options.jobProgress || useJobProgress()
  const created = await options.create()
  const jobId = extractJobId(created.data)
  if (!jobId) throw new Error(`${options.label}任务创建失败`)

  await options.onStart?.()

  const poll = () =>
    jobProgress.pollJob(jobId, {
      label: options.label,
      fetchJob: async (id) => (await options.fetchJob(id)) as ProgressJob,
    })

  const job = await poll()
  const failed = jobProgress.failedItems(job).map((item) => formatFailedJobItem(item))
  if (failed.length) {
    await showBatchFailures(job?.message || `${options.label}完成`, failed, options.failureUnit || '条', {
      onRetry: options.retry
        ? async () => {
            await options.retry!(jobId)
            return poll()
          }
        : undefined,
    })
  } else {
    toast.success(job?.message || `${options.label}完成`)
  }
  options.clearSelection?.()
  await options.onDone?.()
  return (job as JobLike) || null
}
