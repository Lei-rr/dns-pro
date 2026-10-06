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
  /**
   * 成功载荷。204/空体/后端显式 data:null 三条路径都由传输层如实归一为 null，
   * 端点声明「可能有/没有载荷」用 ApiResult<T>（见下），不要在别处构造 `null as T`。
   */
  data: T
  meta?: Record<string, unknown>
  side_effects?: SideEffects
  [key: string]: unknown
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T>

/**
 * 传输层成功响应的真实形状：载荷可能不存在（204 删除、空体、后端显式 data:null），
 * 此时 data 为 null 而不是伪装的 T。
 *
 * 端点按契约声明载荷类型：确知有载荷用 ApiResponse<T>（经 unwrapItem 守卫），
 * 可能无载荷直接用 ApiResult<T>，让「可能为 null」进入类型、由消费点显式处理。
 */
export type ApiResult<T = unknown> = ApiSuccessResponse<T | null>

export interface ListResponse<T> {
  [key: string]: unknown
  items: T[]
  meta?: Record<string, unknown>
  pagination?: Record<string, unknown>
}
