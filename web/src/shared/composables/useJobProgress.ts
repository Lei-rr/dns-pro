import { ref } from 'vue'

export type JobLike = {
  id?: string
  status?: string
  total?: number
  done?: number
  success?: number
  failed?: number
  skipped?: number
  current?: string
  message?: string
  items?: Array<Record<string, unknown>>
}

export type PollJobOptions = {
  /** fetch latest job by id */
  fetchJob: (jobId: string) => Promise<JobLike>
  intervalMs?: number
  onTick?: (job: JobLike) => void
  isActive?: (job: JobLike) => boolean
  /** optional progress label prefix, e.g. 后台修改 / 后台切换 */
  label?: string
}

/**
 * Generic job polling helper for long-running backend tasks.
 */
export function useJobProgress() {
  const running = ref(false)
  const text = ref('')
  const job = ref<JobLike | null>(null)

  function isActiveStatus(status?: string) {
    return status === 'pending' || status === 'running'
  }

  function progressText(current: JobLike, label = '') {
    const prefix = label ? `${label} ` : ''
    if (current.current) {
      return `${prefix}${current.done || 0}/${current.total || 0}：${current.current}`
    }
    if (current.message && !isActiveStatus(current.status)) return current.message
    return `${prefix}${current.done || 0}/${current.total || 0}`
  }

  async function pollJob(jobId: string, options: PollJobOptions): Promise<JobLike | null> {
    const interval = Math.max(300, options.intervalMs ?? 1000)
    running.value = true
    try {
      let current: JobLike | null = { id: jobId, status: 'pending' }
      while (current && (options.isActive?.(current) ?? isActiveStatus(current.status))) {
        job.value = current
        text.value = progressText(current, options.label)
        options.onTick?.(current)
        await new Promise((r) => setTimeout(r, interval))
        current = await options.fetchJob(jobId)
      }
      job.value = current
      text.value = current?.message || text.value
      return current
    } finally {
      running.value = false
    }
  }

  function failedItems(current?: JobLike | null) {
    return ((current?.items || []) as Array<Record<string, unknown>>).filter((i) => i.status === 'failed')
  }

  return {
    running,
    text,
    job,
    pollJob,
    failedItems,
    progressText,
  }
}
