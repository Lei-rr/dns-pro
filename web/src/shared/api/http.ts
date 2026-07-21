/**
 * Native fetch client for dns-pro.
 * HTTP client surface (native fetch):
 * - baseURL /api
 * - returns API JSON body directly
 * - supports { params }
 * - 401 → unauthorizedHandler
 */
import type { ApiResponse, ListResponse } from '@/shared/types'

export type RequestError = Error & { code: string; details: unknown; status: number }

export type RequestConfig = {
  params?: Record<string, unknown>
  headers?: Record<string, string>
  signal?: AbortSignal
  timeout?: number
  data?: unknown
}

const DEFAULT_TIMEOUT_MS = 120000

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler
}

function buildUrl(baseURL: string, url: string, params?: Record<string, unknown>): string {
  const path = url.startsWith('http') ? url : `${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`
  const target = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
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

function toRequestError(
  message: string,
  init: { code?: string; details?: unknown; status?: number } = {},
): RequestError {
  const error = new Error(message) as RequestError
  error.code = init.code || 'REQUEST_FAILED'
  error.details = init.details || {}
  error.status = init.status || 0
  return error
}

async function request<T = unknown>(
  method: string,
  url: string,
  config: RequestConfig = {},
): Promise<ApiResponse<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeout ?? DEFAULT_TIMEOUT_MS)
  if (config.signal) {
    if (config.signal.aborted) controller.abort()
    else config.signal.addEventListener('abort', () => controller.abort(), { once: true })
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
      credentials: 'include',
      signal: controller.signal,
    })
    const payload = await parseBody(response)

    if (!response.ok) {
      const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const error = toRequestError(String(obj.message || response.statusText || '请求失败'), {
        code: String(obj.code || 'REQUEST_FAILED'),
        details: obj.details || {},
        status: response.status,
      })
      if (response.status === 401) unauthorizedHandler?.()
      throw error
    }

    // 204 / empty
    if (payload == null) {
      return { code: 0, message: 'success', data: null as T }
    }
    return payload as ApiResponse<T>
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && 'code' in error) throw error
    if ((error as Error)?.name === 'AbortError') {
      throw toRequestError('请求超时或已取消', { code: 'TIMEOUT', status: 0 })
    }
    throw toRequestError((error as Error)?.message || '网络错误', { code: 'NETWORK_ERROR', status: 0 })
  } finally {
    clearTimeout(timer)
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

  return { params: refresh ? { ...queryParams, refresh: 1 } : queryParams }
}

function isListResponse<T>(data: unknown): data is ListResponse<T> {
  return typeof data === 'object' && data !== null && Array.isArray((data as ListResponse<T>).items)
}

export function unwrapItems<T>(response: ApiResponse<unknown>): ApiResponse<T> {
  const data = response.data
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
      total: Number(pagination.total ?? metaObj.total ?? data.items.length ?? 0),
      count: Number(pagination.count ?? metaObj.count ?? data.items.length ?? 0),
      offset: Number(pagination.offset ?? metaObj.offset ?? 0),
      limit: Number(pagination.limit ?? metaObj.limit ?? metaObj.per_page ?? data.items.length ?? 0),
      page: Number(metaObj.page ?? 0) || undefined,
      per_page: Number(metaObj.per_page ?? pagination.limit ?? 0) || undefined,
    }
    return { ...response, data: data.items as T, meta }
  }
  return response as ApiResponse<T>
}

export default http
