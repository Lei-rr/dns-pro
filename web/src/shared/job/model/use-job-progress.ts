import { ref } from 'vue'
import type { JobLike, PollJobOptions } from './types'
import { createScopeGeneration, type GenerationOwner } from '../../lib/scope-generation'

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
  const resumeError = ref('')
  let clearTimer: ReturnType<typeof setTimeout> | null = null
  const ownership = createScopeGeneration()

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

  function cancelAutoClear() {
    if (!clearTimer) return
    clearTimeout(clearTimer)
    clearTimer = null
  }

  /** Claim exclusive ownership of visible job progress and invalidate all older async work. */
  function begin(initialText = ''): GenerationOwner {
    const owner = ownership.claim()
    cancelAutoClear()
    running.value = true
    text.value = initialText
    job.value = null
    percent.value = null
    return owner
  }

  function scheduleAutoClear(owner: GenerationOwner, ms = 3000) {
    cancelAutoClear()
    if (ms <= 0 || !owner.active()) return
    clearTimer = setTimeout(() => {
      clearTimer = null
      if (!owner.active() || running.value) return
      text.value = ''
      job.value = null
      percent.value = null
    }, ms)
  }

  async function pollOwned(jobId: string, options: PollJobOptions, owner: GenerationOwner): Promise<JobLike | null> {
    if (!jobId || !owner.active()) return null
    const interval = Math.max(300, options.intervalMs ?? 1000)
    const autoClearMs = options.autoClearMs ?? 3000
    running.value = true
    try {
      let current: JobLike | null = { id: jobId, status: 'pending' }
      while (current && (options.isActive?.(current) ?? isActiveStatus(current.status))) {
        if (!owner.active()) return null
        job.value = current
        text.value = progressText(current, options.label)
        percent.value = progressPercent(current)
        options.onTick?.(current)
        await new Promise((resolve) => setTimeout(resolve, interval))
        if (!owner.active()) return null
        current = await options.fetchJob(jobId)
      }
      if (!owner.active()) return null
      job.value = current
      text.value = current?.message || text.value
      percent.value = current ? progressPercent(current) : null
      return current
    } finally {
      if (owner.active()) {
        running.value = false
        if (text.value || job.value) scheduleAutoClear(owner, autoClearMs)
      }
    }
  }

  async function pollJob(jobId: string, options: PollJobOptions, owner = begin()): Promise<JobLike | null> {
    return pollOwned(jobId, options, owner)
  }

  /** Resume an in-flight backend job; a later begin/reset makes every late response inert. */
  async function resumeActive(
    fetchActive: () => Promise<{ data?: unknown } | unknown>,
    options: PollJobOptions
  ): Promise<JobLike | null> {
    if (running.value) return job.value
    const owner = begin()
    resumeError.value = ''
    try {
      const response = await fetchActive()
      if (!owner.active()) return null
      const data =
        response && typeof response === 'object' && 'data' in (response as object)
          ? (response as { data?: unknown }).data
          : response
      if (!data) {
        release(owner)
        return null
      }
      const jobId = extractJobId(data)
      if (!jobId) {
        release(owner)
        return null
      }
      if (typeof data === 'object') {
        job.value = data as JobLike
        text.value = progressText(data as JobLike, options.label)
        percent.value = progressPercent(data as JobLike)
      }
      return await pollOwned(jobId, options, owner)
    } catch (error) {
      resumeError.value = error instanceof Error ? error.message : String(error)
      release(owner)
      return null
    }
  }

  function failedItems(current?: JobLike | null) {
    return ((current?.items || []) as Array<Record<string, unknown>>).filter((item) => item.status === 'failed')
  }

  function release(owner: GenerationOwner) {
    if (!owner.active()) return
    running.value = false
    if (!text.value && !job.value) return
    scheduleAutoClear(owner)
  }

  function reset() {
    ownership.invalidate()
    cancelAutoClear()
    running.value = false
    text.value = ''
    job.value = null
    percent.value = null
    resumeError.value = ''
  }

  return {
    running,
    text,
    job,
    percent,
    resumeError,
    begin,
    owns: (owner: GenerationOwner) => owner.active(),
    release,
    pollJob,
    resumeActive,
    failedItems,
    progressText,
    reset,
    extractJobId,
  }
}
