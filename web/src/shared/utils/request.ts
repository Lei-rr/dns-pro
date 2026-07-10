import axios from 'axios'

const http = axios.create({
  baseURL: '/api',
  timeout: 120000,
  withCredentials: true,
})

http.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const payload = error.response?.data || {}
    const message = payload.message || error.message || '请求失败'
    const requestError = new Error(message) as Error & { code: string; details: unknown; status: number }
    requestError.code = payload.code || 'REQUEST_FAILED'
    requestError.details = payload.details || {}
    requestError.status = error.response?.status || 0
    if (error.response?.status === 401 && location.hash !== '#/login') {
      window.dispatchEvent(new CustomEvent('auth-invalidated'))
      location.hash = '#/login'
    }
    return Promise.reject(requestError)
  }
)

export function withRefresh(options: Record<string, unknown> = {}) {
  const { refresh, params = {} } = options
  const queryParams = { ...(params as Record<string, unknown>) }

  for (const [key, value] of Object.entries(queryParams)) {
    if (key === 'refresh' || value === undefined || value === null || value === '') delete queryParams[key]
  }

  return { params: refresh ? { ...queryParams, refresh: 1 } : queryParams }
}

export function unwrapItems<T>(response: Record<string, unknown>): import('@/types').ApiResponse<T> {
  if (Array.isArray(response?.data)) {
    return { ...response, data: response.data as T } as import('@/types').ApiResponse<T>
  }
  const data = response?.data as Record<string, unknown> | undefined
  if (Array.isArray(data?.items)) {
    return {
      ...response,
      data: data.items as T,
      meta: data.meta || data.pagination || data,
    } as import('@/types').ApiResponse<T>
  }
  return response as import('@/types').ApiResponse<T>
}

export default http
