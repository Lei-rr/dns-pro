/**
 * Native fetch client for dns-pro.
 * HTTP client surface (native fetch):
 * - baseURL /api
 * - returns API JSON body directly
 * - supports { params }
 * - 401 → unauthorizedHandler
 * - 中断语义：内部超时 → TIMEOUT（用户可见）；外部 signal 取消 → CANCELED（消费侧静默），见 transport-errors.ts
 */
import type { ApiResponse, ApiResult, ListResponse } from '@/shared/api/types'
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

/** 契约错误码：成功响应的形状与端点声明不符（解包器抛出，消费侧按失败处理而不是静默降级） */
const INVALID_RESPONSE_CODE = 'INVALID_RESPONSE'

function invalidResponse(message: string, status = 0): RequestError {
  return toRequestError(message, { code: INVALID_RESPONSE_CODE, status })
}

/** JSON 信封与分页元数据都要求「非 null、非数组的对象」 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 反序列化边界唯一一次「未知载荷 → 声明类型」的转换：浏览器运行期没有泛型，
 * 载荷形状由后端 schema 与调用点声明共同保证；这里只把缺失归一成 null，
 * 让可空性如实进入类型，而不是在别处写成 `null as T`。
 */
function declarePayload<T>(data: unknown): T | null {
  return data == null ? null : (data as T)
}

/** 兼容成功响应的唯一来源：信封形状在此校验，载荷可空性由 ApiResult<T> 表达 */
function successPayload<T>(payload: unknown, status: number): ApiResult<T> {
  if (!isRecord(payload)) throw invalidResponse('接口返回的响应体格式不正确', status)
  return {
    ...payload,
    code: 0,
    message: 'success',
    data: declarePayload<T>(payload.data),
  }
}

async function request<T = unknown>(method: string, url: string, config: RequestConfig = {}): Promise<ApiResult<T>> {
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
      const obj = isRecord(payload) ? payload : {}
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

    // 204 / 空体：成功但没有载荷。如实归一为 null（ApiResult），不构造 `null as T` 冒充载荷
    if (payload == null) {
      return { code: 0, message: 'success', data: null }
    }
    return successPayload<T>(payload, response.status)
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
}

export function withRefresh(options: Record<string, unknown> = {}) {
  const { refresh, params } = options
  // 非对象 params 直接丢弃：调用方契约是对象，spread 字符串只会产出无意义的字符键
  const queryParams: Record<string, unknown> = isRecord(params) ? { ...params } : {}

  for (const [key, value] of Object.entries(queryParams)) {
    if (key === 'refresh' || value === undefined || value === null || value === '') delete queryParams[key]
  }

  return { params: refresh ? { ...queryParams, refresh: true } : queryParams }
}

function isListPayload(data: unknown): data is ListResponse<unknown> {
  return isRecord(data) && Array.isArray(data.items)
}

/** 分页元数据可能在 meta 或 pagination 之下；CF SaaS 用 total_count，DNSPod/EdgeOne 用 total */
function listMeta(items: unknown[], data: ListResponse<unknown>): Record<string, unknown> {
  const pagination = isRecord(data.pagination) ? data.pagination : {}
  const metaObj = isRecord(data.meta) ? data.meta : {}
  return {
    ...metaObj,
    ...pagination,
    total: Number(pagination.total_count ?? pagination.total ?? metaObj.total_count ?? metaObj.total ?? items.length),
    count: Number(pagination.count ?? metaObj.count ?? items.length),
    offset: Number(pagination.offset ?? metaObj.offset ?? 0),
    limit: Number(pagination.limit ?? metaObj.limit ?? metaObj.per_page ?? pagination.per_page ?? items.length),
    page: Number(pagination.page ?? metaObj.page ?? 0) || undefined,
    per_page: Number(pagination.per_page ?? metaObj.per_page ?? pagination.limit ?? 0) || undefined,
    total_count: Number(pagination.total_count ?? metaObj.total_count ?? 0) || undefined,
    total_pages: Number(pagination.total_pages ?? metaObj.total_pages ?? 0) || undefined,
  }
}

/** 数组形状已由守卫确认；元素类型是调用方声明的后端契约（运行期无法逐个校验元素） */
function itemsAs<T>(items: unknown[]): T[] {
  return items as T[]
}

/**
 * 列表端点解包：只认两种真实形状（顶层数组 / { items }），形状不认识就抛错。
 * 空体/null 归一到空数组——列表端点的「无数据」语义就是空列表，不是把 [] 断言成别的类型。
 */
export function unwrapList<T>(response: ApiResponse<unknown>): ApiResponse<T[]> {
  const data = response.data
  if (data == null) return { ...response, data: [] }
  if (Array.isArray(data)) return { ...response, data: itemsAs<T>(data) }
  if (isListPayload(data)) return { ...response, data: itemsAs<T>(data.items), meta: listMeta(data.items, data) }
  throw invalidResponse('接口返回的列表数据格式不正确')
}

/**
 * 详情端点解包：必须命中调用方给的守卫才返回，否则抛错。
 * 详情端点若沿用列表解包，空体时会得到 [] 并被断言成单条对象，消费侧的 truthy 判断拦不住空数组。
 */
export function unwrapItem<T>(response: ApiResponse<unknown>, guard: (value: unknown) => value is T): ApiResponse<T> {
  const data = response.data
  if (!guard(data)) throw invalidResponse('接口返回的详情数据格式不正确')
  return { ...response, data }
}

export default http
