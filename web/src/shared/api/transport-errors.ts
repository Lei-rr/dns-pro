/**
 * 传输层中断语义与错误码的唯一来源。
 *
 * 超时（本层定时器触发）与主动取消（外部 signal：组件卸载、作用域切换、用户刷新、queryClient 取消）
 * 在 fetch 层面完全同形：都抛 AbortError，错误对象里不带「谁中断的」这一信息。
 * 判定只能来自发起 abort 时的记录值，因此码值、判定与文案集中在这里：
 * http.ts 只负责记录来源并抛出，shared/lib/errors.ts 只负责展示，两边都从这里取，避免同一语义各写一遍。
 */

/** 本层定时器触发的超时：用户可见的失败 */
export const TIMEOUT_CODE = 'TIMEOUT'
/** 外部 signal 触发的取消：不是错误，消费侧必须静默 */
export const CANCELED_CODE = 'CANCELED'
/** fetch 自身失败（断网 / 连接被拒 / DNS）：没有后端响应体，文案由本地兜底 */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR'

type TransportErrorCode = typeof TIMEOUT_CODE | typeof CANCELED_CODE | typeof NETWORK_ERROR_CODE

/** 本地网络层兜底文案：与码值同源，抛出方与展示方不再各写一份 */
export const TRANSPORT_ERROR_HINTS: Record<TransportErrorCode, string> = {
  [TIMEOUT_CODE]: '请求超时',
  [CANCELED_CODE]: '请求已取消',
  [NETWORK_ERROR_CODE]: '网络连接失败，请检查网络后重试',
}

/** 中断来源：timeout = 本层定时器；canceled = 外部 signal */
export type InterruptSource = 'timeout' | 'canceled'

/** 错误对象可能来自 fetch、DOMException 或后端响应，码值只在确为字符串时才可用 */
function codeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  if (!('code' in error)) return ''
  return typeof error.code === 'string' ? error.code : ''
}

export function isTransportErrorCode(value: unknown): value is TransportErrorCode {
  // 必须挡原型链：`in` 会命中原型（'toString' in {} === true），命中的函数会被 errors.ts 当作提示文案返回
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TRANSPORT_ERROR_HINTS, value)
}

/**
 * 取消判定：全仓唯一入口，不要在别处比较 error.name === 'AbortError'。
 * 超时同样会产生该 name，两者只能靠中断来源区分；任何新增判定都走这里。
 */
export function isCanceledError(error: unknown): boolean {
  return codeOf(error) === CANCELED_CODE
}
