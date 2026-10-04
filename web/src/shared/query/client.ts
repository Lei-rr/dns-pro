import { QueryClient } from '@tanstack/vue-query'

/**
 * 全局唯一 QueryClient。
 * 约定（蓝图 D8 / R2）：
 * - 读路径统一走 query；写路径成功后只做 invalidate，不再手写“全量重载 / 本地删 / 本地 patch”。
 * - 失败不自动重试：错误已即时反馈给用户，重试由用户显式触发。
 * - 上游数据只在显式刷新时绕过服务端缓存，因此默认 staleTime 内直接复用本地结果。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: false,
    },
  },
})
