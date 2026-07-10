import axios, { type AxiosRequestConfig } from 'axios'
import type { ApiResponse, ListResponse } from '@/types'

export type RequestError = Error & { code: string; details: unknown; status: number }

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler
}

const axiosClient = axios.create({
  baseURL: '/api',
  timeout: 120000,
  withCredentials: true,
})

axiosClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const payload = error.response?.data || {}
    const message = payload.message || error.message || '请求失败'
    const requestError = new Error(message) as RequestError
    requestError.code = payload.code || 'REQUEST_FAILED'
    requestError.details = payload.details || {}
    requestError.status = error.response?.status || 0
    if (requestError.status === 401) {
      unauthorizedHandler?.()
    }
    return Promise.reject(requestError)
  }
)

const http = {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig) => axiosClient.get<unknown, ApiResponse<T>>(url, config),
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    axiosClient.post<unknown, ApiResponse<T>>(url, data, config),
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    axiosClient.put<unknown, ApiResponse<T>>(url, data, config),
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    axiosClient.delete<unknown, ApiResponse<T>>(url, config),
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
    return { ...response, data: data.items as T, meta: data.meta ?? data.pagination ?? data }
  }
  return response as ApiResponse<T>
}

export default http
