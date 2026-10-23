/**
 * 错误文案唯一来源是后端 `server/core/http/error-messages.ts`：
 * 错误响应体已带本地化 message，前端只做透传 + 本地网络层兜底，不再维护错误码对照表。
 *
 * 本地兜底只剩一种情形：请求根本没拿到响应体（超时 / 取消 / 断网）。这类失败的码值和文案
 * 与判定逻辑同源，直接取 shared/api/transport-errors.ts 的表，避免抛出方与展示方各写一份。
 *
 * 取消不是错误：调用方在 toast 之前必须先过 isCanceledError（读路径见 shared/query/use-resource-query.ts）。
 * 本函数不把取消文案清空——它还服务于表单内联提示与失败清单，清空只会让那些位置变成空白。
 */
import { isTransportErrorCode, TRANSPORT_ERROR_HINTS } from '@/shared/api/transport-errors'

/** 错误来源形态不可控（fetch、DOMException、后端响应体）：只读取已知字段，非字符串/数字一律当缺失 */
function fieldText(error: unknown, key: string): string {
  if (typeof error !== 'object' || error === null || !(key in error)) return ''
  const value: unknown = Reflect.get(error, key)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

export function errorMessage(error: unknown, fallback = '请求失败'): string {
  if (typeof error === 'string' && error.trim()) return error

  // transport 是 shared/api/http.ts 的原生 fetch：RequestError 只有 code/details/status，没有 axios 的 response
  const code = fieldText(error, 'code').trim()
  const message = fieldText(error, 'message').trim()
  const status = Number(fieldText(error, 'status') || 0)

  const transportHint: string = isTransportErrorCode(code) ? TRANSPORT_ERROR_HINTS[code] : ''
  // 上游原因拼在本地化文案之后：后端 message 是统一话术（http_error →「请求失败」），
  // 不带上这一句，4xx 参数错误在前端等于没有任何信息
  const upstream = upstreamHint(error)
  const withUpstream = (text: string) => (upstream ? `${text}：${upstream}` : text)

  if (transportHint) return withUpstream(transportHint)
  if (message && /[\u4e00-\u9fff]/.test(message)) return withUpstream(message)

  if (status === 401) return '登录已失效，请重新登录'
  if (status === 403) return '没有权限执行该操作'
  if (status === 404) return '资源不存在'
  if (status >= 500) return '服务暂时异常，请稍后重试'
  if (message) return withUpstream(message)

  return withUpstream(fallback)
}

/** 后端白名单里唯一放行的上游原因（details.upstream_error），只取字符串，缺失当没有 */
function upstreamHint(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const details = Reflect.get(error, 'details')
  if (typeof details !== 'object' || details === null) return ''
  const value: unknown = Reflect.get(details, 'upstream_error')
  return typeof value === 'string' ? value.trim() : ''
}
