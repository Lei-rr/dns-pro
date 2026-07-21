import { ref } from 'vue'

export type JobLike = {
  id?: string
  status?: string
  total?: number
  done?: number
  success?: number
  failed?: number
  skipped?: number
  current?: string | number
  message?: string
  items?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type PollJobOptions = {
  fetchJob: (jobId: string) => Promise<JobLike>
  intervalMs?: number
  onTick?: (job: JobLike) => void
  isActive?: (job: JobLike) => boolean
  label?: string
}

export function extractJobId(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  if (d.id != null && d.id !== '') return String(d.id)
  if (d.job_id != null && d.job_id !== '') return String(d.job_id)
  const nested = d.job
  if (nested && typeof nested === 'object' && (nested as { id?: unknown }).id != null) {
    return String((nested as { id?: unknown }).id)
  }
  return ''
}

export function useJobProgress() {
  const running = ref(false)
  const text = ref('')
  const job = ref<JobLike | null>(null)
  const percent = ref<number | null>(null)

  function isActiveStatus(status?: string) {
    return status === 'pending' || status === 'running'
  }

  function progressPercent(current: JobLike) {
    const total = Number(current.total || 0)
    const done = Number(current.done || 0)
    if (!total) return null
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  }

  function progressText(current: JobLike, label = '') {
    const prefix = label ? `${label} ` : ''
    const currentLabel = current.current != null && current.current !== '' ? String(current.current) : ''
    if (currentLabel) return `${prefix}${current.done || 0}/${current.total || 0}：${currentLabel}`
    if (current.message && !isActiveStatus(current.status)) return current.message
    return `${prefix}${current.done || 0}/${current.total || 0}`
  }

  async function pollJob(jobId: string, options: PollJobOptions): Promise<JobLike | null> {
    if (!jobId || running.value) return job.value
    const interval = Math.max(300, options.intervalMs ?? 1000)
    running.value = true
    try {
      let current: JobLike | null = { id: jobId, status: 'pending' }
      while (current && (options.isActive?.(current) ?? isActiveStatus(current.status))) {
        job.value = current
        text.value = progressText(current, options.label)
        percent.value = progressPercent(current)
        options.onTick?.(current)
        await new Promise((r) => setTimeout(r, interval))
        current = await options.fetchJob(jobId)
      }
      job.value = current
      text.value = current?.message || text.value
      percent.value = current ? progressPercent(current) : null
      return current
    } finally {
      running.value = false
    }
  }

  /** Resume an in-flight backend job if active endpoint returns one. */
  async function resumeActive(
    fetchActive: () => Promise<{ data?: unknown } | unknown>,
    options: PollJobOptions,
  ): Promise<JobLike | null> {
    if (running.value) return job.value
    try {
      const response = await fetchActive()
      const data =
        response && typeof response === 'object' && 'data' in (response as object)
          ? (response as { data?: unknown }).data
          : response
      if (!data) return null
      const jobId = extractJobId(data)
      if (!jobId) return null
      if (data && typeof data === 'object') {
        job.value = data as JobLike
        text.value = progressText(data as JobLike, options.label)
        percent.value = progressPercent(data as JobLike)
      }
      return await pollJob(jobId, options)
    } catch {
      return null
    }
  }

  function failedItems(current?: JobLike | null) {
    return ((current?.items || []) as Array<Record<string, unknown>>).filter((i) => i.status === 'failed')
  }

  function reset() {
    running.value = false
    text.value = ''
    job.value = null
    percent.value = null
  }

  return { running, text, job, percent, pollJob, resumeActive, failedItems, progressText, reset, extractJobId }
}
