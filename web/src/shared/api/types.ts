type MutationSideEffectStatus = 'completed' | 'skipped' | 'failed'

/** @public 前端副作用契约，由审计探针校验 */
export interface MutationSideEffect {
  status: MutationSideEffectStatus
  message: string
  details?: unknown[] | { cleaned?: number; [key: string]: unknown }
  [key: string]: unknown
}

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

interface ApiSuccessResponse<T = unknown> {
  code: 0
  message: 'success'
  data: T
  meta?: Record<string, unknown>
  side_effects?: SideEffects
  [key: string]: unknown
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T>

export interface ListResponse<T> {
  [key: string]: unknown
  items: T[]
  meta?: Record<string, unknown>
  pagination?: Record<string, unknown>
}
