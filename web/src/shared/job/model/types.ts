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
  /**
   * 拉取任务详情。详情缺失（204/空体/后端 data:null）如实返回 null，由轮询层按未知状态处理；
   * 不要在这里补 {} —— 空对象同样判为缺失，但会掩盖「读不到详情」的真实原因。
   */
  fetchJob: (jobId: string) => Promise<JobLike | null>
  intervalMs?: number
  isActive?: (job: JobLike) => boolean
  label?: string
  /** 完成后横幅保留多久再淡出清除，默认 3000ms；0 = 不自动清除 */
  autoClearMs?: number
}

export type CreateJobResult = { data?: unknown }
