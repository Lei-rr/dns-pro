export type MutationSideEffectStatus = 'completed' | 'skipped' | 'failed'

export interface MutationSideEffect {
  status: MutationSideEffectStatus
  message: string
  details?: unknown[] | { cleaned?: number; [key: string]: unknown }
  [key: string]: unknown
}

/** Compatibility name retained for existing consumers. */
export type ApiSideEffect = MutationSideEffect

export interface SideEffects {
  dns?: {
    sync?: MutationSideEffect
    cleanup?: MutationSideEffect
    [key: string]: unknown
  }
  tunnel?: {
    token?: MutationSideEffect
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

/** Stable response DTO returned by mutation endpoints that enqueue a job. */
export interface JobCommand {
  id?: string
  job_id?: string
  job?: { id?: string }
}

export interface ApiSuccessResponse<T = unknown> {
  code: 0
  message: 'success'
  data: T
  meta?: Record<string, unknown>
  side_effects?: SideEffects
  [key: string]: unknown
}

export interface ApiErrorResponse {
  message: string
  code: string
  status: number
  details?: unknown
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T>

export interface ListResponse<T> {
  [key: string]: unknown
  items: T[]
  meta?: Record<string, unknown>
  pagination?: Record<string, unknown>
}
