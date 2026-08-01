/** Durable job record types (platform). */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

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
  items: Array<Record<string, unknown>>
  created_at: number
  updated_at: number
  finished_at?: number
  message?: string
}
