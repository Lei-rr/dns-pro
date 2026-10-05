import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/vue-query'
import { loadPageSize, savePageSize } from '@/shared/lib/page-size'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

type ResourceQueryContext = {
  refresh: boolean
  /** TanStack 的取消信号：卸载或作用域失效时用它中止在飞请求 */
  signal: AbortSignal
}

type ResourceQueryOptions<T> = {
  /** 查询键（含 scope），由调用方按域约定构造 */
  key: MaybeRefOrGetter<QueryKey>
  /** 显式刷新（refresh=true）时必须携带 refresh 参数绕过服务端缓存 */
  queryFn: (context: ResourceQueryContext) => Promise<T>
  /** 每页条数的 localStorage 记忆键；无分页 UI 的读路径不传，避免留下读不到也写不进的死配置 */
  pageSizeScope?: string
  defaultPageSize?: number
  /** 刷新完成提示；默认「已刷新」，传空字符串则静默 */
  refreshNotice?: string
}

type ResourceQuery<T> = {
  data: Ref<T | undefined>
  loading: Ref<boolean>
  refreshing: Ref<boolean>
  error: Ref<unknown>
  pageSize: Ref<number>
  setPageSize: (next: number) => void
  refresh: () => Promise<void>
  invalidate: () => Promise<void>
}

const REFRESH_MIN_MS = 120

/**
 * 列表/详情读路径的统一入口：TanStack Query + 显式刷新语义。
 * 取代旧的 useListPage 手写 loading/refresh 组合式，是 shared 内唯一并发原语。
 */
export function useResourceQuery<T>(options: ResourceQueryOptions<T>): ResourceQuery<T> {
  const client = useQueryClient()
  const fallbackPageSize = options.defaultPageSize ?? 20
  const pageSize = ref(options.pageSizeScope ? loadPageSize(options.pageSizeScope, fallbackPageSize) : fallbackPageSize)
  const refreshing = ref(false)
  const refreshFlag = ref(false)
  const dispose = ref(true)
  onScopeDispose(() => {
    dispose.value = false
  })

  const key = computed<QueryKey>(() => toValue(options.key))

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => options.queryFn({ refresh: refreshFlag.value, signal }),
  })

  const loading = computed(() => query.isPending.value || (query.isFetching.value && query.data.value === undefined))

  // 读取失败即时反馈一次；重试由用户显式触发
  watch(query.error, (error) => {
    if (error) toast.error(errorMessage(error))
  })

  async function refresh() {
    if (refreshing.value) return
    refreshing.value = true
    refreshFlag.value = true
    const started = Date.now()
    try {
      const result = await query.refetch()
      if (result.error) return
      const wait = Math.max(0, REFRESH_MIN_MS - (Date.now() - started))
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      const notice = options.refreshNotice ?? '已刷新'
      if (notice) toast.success(notice)
    } finally {
      refreshFlag.value = false
      if (dispose.value) refreshing.value = false
    }
  }

  async function invalidate() {
    await client.invalidateQueries({ queryKey: key.value })
  }

  function setPageSize(next: number) {
    pageSize.value = next
    if (options.pageSizeScope) savePageSize(options.pageSizeScope, next)
  }

  return {
    data: query.data,
    loading,
    refreshing,
    error: query.error,
    pageSize,
    setPageSize,
    refresh,
    invalidate,
  }
}
