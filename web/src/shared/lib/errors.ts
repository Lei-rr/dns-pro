/**
 * 错误文案唯一来源是后端 `server/core/http/error-messages.ts`：
 * 错误响应体已带本地化 message，前端只做透传 + 本地网络层兜底，不再维护错误码对照表。
 */
const LOCAL_CODE_HINTS: Record<string, string> = {
  TIMEOUT: '请求超时或已取消',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
}

export function errorMessage(error: unknown, fallback = '请求失败'): string {
  if (typeof error === 'string' && error.trim()) return error

  const err = error as {
    message?: string
    code?: string
    status?: number
    response?: { data?: { message?: string; code?: string }; status?: number }
  }

  const code = String(err?.code || err?.response?.data?.code || '').trim()
  const message = String(err?.response?.data?.message || err?.message || '').trim()
  const status = Number(err?.status || err?.response?.status || 0)

  if (LOCAL_CODE_HINTS[code]) return LOCAL_CODE_HINTS[code]
  if (message && /[\u4e00-\u9fff]/.test(message)) return message

  if (status === 401) return '登录已失效，请重新登录'
  if (status === 403) return '没有权限执行该操作'
  if (status === 404) return '资源不存在'
  if (status >= 500) return '服务暂时异常，请稍后重试'
  if (message) return message

  return fallback
}
