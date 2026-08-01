export type JobItem = Record<string, unknown> & {
  status?: unknown
  message?: unknown
  hostname?: unknown
  name?: unknown
  type?: unknown
  record_id?: unknown
  domain?: unknown
}

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
  items?: JobItem[]
  [key: string]: unknown
}

export type PollJobOptions = {
  fetchJob: (jobId: string) => Promise<JobLike>
  intervalMs?: number
  onTick?: (job: JobLike) => void
  isActive?: (job: JobLike) => boolean
  label?: string
  /** 完成后横幅保留多久再淡出清除，默认 3000ms；0 = 不自动清除 */
  autoClearMs?: number
}

export type CreateJobResult = { data?: unknown }
