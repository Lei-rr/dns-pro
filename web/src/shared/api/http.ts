/**
 * Native fetch client for dns-pro.
 * HTTP client surface (native fetch):
 * - baseURL /api
 * - returns API JSON body directly
 * - supports { params }
 * - 401 → unauthorizedHandler
 * - 中断语义：内部超时 → TIMEOUT（用户可见）；外部 signal 取消 → CANCELED（消费侧静默），见 transport-errors.ts
 */
import type { ApiResponse, ListResponse } from '@/shared/api/types'
import {
  CANCELED_CODE,
  NETWORK_ERROR_CODE,
  TIMEOUT_CODE,
  TRANSPORT_ERROR_HINTS,
  type InterruptSource,
} from '@/shared/api/transport-errors'

export type RequestError = Error & { code: string; details: unknown; status: number }

type RequestConfig = {
  params?: Record<string, unknown>
  headers?: Record<string, string>
  timeout?: number
  data?: unknown
  /**
   * 外部取消信号（组件卸载 / 作用域切换 / TanStack 查询取消）。
   * 与内部超时合并进同一个 AbortController，但语义不同：超时是失败，取消不是错误。
   */
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 120000

/** 轮询 / 会话检查等轻量请求：单次请求不该卡住进度 UI。 */
export const POLL_TIMEOUT_MS = 10000

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler
}

// Same-origin only: the returned path drops any origin, so absolute URLs never escape the app host.
function buildUrl(baseURL: string, url: string, params?: Record<string, unknown>): string {
  const target = new URL(`${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`, 'http://localhost')
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value)) {
        for (const item of value) target.searchParams.append(key, String(item))
      } else {
        target.searchParams.set(key, String(value))
      }
    }
  }
  return `${target.pathname}${target.search}`
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** fetch 的失败形态不可控（DOMException / TypeError / 字符串）：只在确为 Error 时取 message */
function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

function toRequestError(
  message: string,
  init: { code?: string; details?: unknown; status?: number } = {}
): RequestError {
  // Object.assign 让附加字段的类型在构造处推断，不需要用 as 断言骗过类型系统
  return Object.assign(new Error(message), {
    code: init.code || 'REQUEST_FAILED',
    details: init.details || {},
    status: init.status || 0,
  })
}

async function request<T = unknown>(method: string, url: string, config: RequestConfig = {}): Promise<ApiResponse<T>> {
  const controller = new AbortController()

  /**
   * 中断来源必须在这里显式记录：超时与取消都只会让 fetch 抛出一模一样的 AbortError，
   * 事后按 error.name 反推会把「用户切页取消」显示成「请求超时」。
   * 先到者胜出——取消之后超时定时器才到期，也不得把语义改写回超时。
   */
  let interrupt: InterruptSource | null = null
  const abortWith = (source: InterruptSource) => {
    if (interrupt) return
    interrupt = source
    controller.abort()
  }

  const timer = setTimeout(() => abortWith('timeout'), config.timeout ?? DEFAULT_TIMEOUT_MS)

  // fetch 只接受一个 signal，外部取消与超时必须合并到同一个 controller
  const external = config.signal
  const abortFromExternal = () => abortWith('canceled')
  if (external) {
    if (external.aborted) abortWith('canceled')
    else external.addEventListener('abort', abortFromExternal, { once: true })
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(config.headers || {}),
  }

  let body: BodyInit | undefined
  if (config.data !== undefined && config.data !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      body = config.data
    } else if (typeof config.data === 'string' || config.data instanceof Blob) {
      body = config.data as BodyInit
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
      body = JSON.stringify(config.data)
    }
  }

  try {
    const response = await fetch(buildUrl('/api', url, config.params), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: controller.signal,
    })
    const payload = await parseBody(response)

    if (!response.ok) {
      const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const code = String(obj.code || 'REQUEST_FAILED')
      const error = toRequestError(String(obj.message || response.statusText || '请求失败'), {
        code,
        details: obj.details || {},
        status: response.status,
      })
      // Session expired / not logged in → jump login.
      // Wrong password (invalid_credentials) stays on the form.
      // 该码被后端复用于两处：登录密码错误（auth.service 登录）与改密时当前密码不正确。
      // 两者都应留在表单上，故此白名单同时覆盖；后端若拆出独立错误码，这里要同步。
      if (response.status === 401 && code !== 'invalid_credentials') unauthorizedHandler?.()
      throw error
    }

    // 204 / empty
    if (payload == null) {
      return { code: 0, message: 'success', data: null as T }
    }
    return payload as ApiResponse<T>
  } catch (error) {
    // 本层构造的 RequestError（HTTP 状态错误）：原样上抛，不再按中断或网络重新分类
    if (error instanceof Error && 'code' in error && 'status' in error) throw error

    if (interrupt === 'canceled') {
      throw toRequestError(TRANSPORT_ERROR_HINTS[CANCELED_CODE], { code: CANCELED_CODE })
    }
    if (interrupt === 'timeout') {
      throw toRequestError(TRANSPORT_ERROR_HINTS[TIMEOUT_CODE], { code: TIMEOUT_CODE })
    }
    throw toRequestError(errorMessageOf(error) || TRANSPORT_ERROR_HINTS[NETWORK_ERROR_CODE], {
      code: NETWORK_ERROR_CODE,
    })
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', abortFromExternal)
  }
}

const http = {
  get: <T = unknown>(url: string, config?: RequestConfig) => request<T>('GET', url, config),
  delete: <T = unknown>(url: string, config?: RequestConfig) => request<T>('DELETE', url, config),
  post: <T = unknown>(url: string, data?: unknown, config?: RequestConfig) =>
    request<T>('POST', url, { ...(config || {}), data }),
  put: <T = unknown>(url: string, data?: unknown, config?: RequestConfig) =>
    request<T>('PUT', url, { ...(config || {}), data }),
  patch: <T = unknown>(url: string, data?: unknown, config?: RequestConfig) =>
    request<T>('PATCH', url, { ...(config || {}), data }),
}

export function withRefresh(options: Record<string, unknown> = {}) {
  const { refresh, params = {} } = options
  const queryParams = { ...(params as Record<string, unknown>) }

  for (const [key, value] of Object.entries(queryParams)) {
    if (key === 'refresh' || value === undefined || value === null || value === '') delete queryParams[key]
  }

  return { params: refresh ? { ...queryParams, refresh: true } : queryParams }
}

function isListResponse<T>(data: unknown): data is ListResponse<T> {
  return typeof data === 'object' && data !== null && Array.isArray((data as ListResponse<T>).items)
}

export function unwrapItems<T>(response: ApiResponse<unknown>): ApiResponse<T> {
  // 204/empty body yields null — a list endpoint always resolves to an array.
  const data = response.data
  if (data == null) return { ...response, data: [] as unknown as T }
  if (Array.isArray(data)) {
    return { ...response, data: data as T }
  }
  if (isListResponse<T>(data)) {
    // Prefer pagination.total (DNSPod/EdgeOne) then meta.total
    const pagination = (data.pagination && typeof data.pagination === 'object' ? data.pagination : {}) as Record<
      string,
      unknown
    >
    const metaObj = (data.meta && typeof data.meta === 'object' ? data.meta : {}) as Record<string, unknown>
    const meta = {
      ...metaObj,
      ...pagination,
      // CF SaaS uses total_count; DNSPod/EdgeOne use total
      total: Number(
        pagination.total_count ?? pagination.total ?? metaObj.total_count ?? metaObj.total ?? data.items.length
      ),
      count: Number(pagination.count ?? metaObj.count ?? data.items.length),
      offset: Number(pagination.offset ?? metaObj.offset ?? 0),
      limit: Number(pagination.limit ?? metaObj.limit ?? metaObj.per_page ?? pagination.per_page ?? data.items.length),
      page: Number(pagination.page ?? metaObj.page ?? 0) || undefined,
      per_page: Number(pagination.per_page ?? metaObj.per_page ?? pagination.limit ?? 0) || undefined,
      total_count: Number(pagination.total_count ?? metaObj.total_count ?? 0) || undefined,
      total_pages: Number(pagination.total_pages ?? metaObj.total_pages ?? 0) || undefined,
    }
    return { ...response, data: data.items as T, meta }
  }
  return response as ApiResponse<T>
}

export default http
