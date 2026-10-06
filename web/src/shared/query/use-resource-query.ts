import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/vue-query'
import { isCanceledError } from '@/shared/api/transport-errors'
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
  /** 刷新完成提示；默认「已刷新」，传空字符串则静默 */
  refreshNotice?: string
}

type ResourceQuery<T> = {
  /**
   * 服务端真相的只读视图：TanStack 把内部 state 包成深 readonly，
   * 因此 data（含其数组与嵌套对象）不可写。
   * 需要就地修改的镜像场景必须先浅拷贝（`data.slice()`），否则赋值静默失效。
   */
  data: Ref<T | undefined>
  loading: Ref<boolean>
  refreshing: Ref<boolean>
  error: Ref<unknown>
  pageSize: Ref<number>
  setPageSize: (next: number) => void
  refresh: () => Promise<void>
  refreshSilently: () => Promise<void>
  invalidate: () => Promise<void>
}

const REFRESH_MIN_MS = 120

/** 未传 pageSizeScope（无分页 UI）时的每页条数兜底 */
const FALLBACK_PAGE_SIZE = 20

/**
 * 列表/详情读路径的统一入口：TanStack Query + 显式刷新语义。
 * 取代旧的 useListPage 手写 loading/refresh 组合式，是 shared 内唯一并发原语。
 */
export function useResourceQuery<T>(options: ResourceQueryOptions<T>): ResourceQuery<T> {
  const client = useQueryClient()
  const pageSize = ref(
    options.pageSizeScope ? loadPageSize(options.pageSizeScope, FALLBACK_PAGE_SIZE) : FALLBACK_PAGE_SIZE
  )
  const refreshing = ref(false)
  const refreshFlag = ref(false)
  const dispose = ref(true)
  onScopeDispose(() => {
    dispose.value = false
  })

  // 「绕过服务端缓存」标志按在飞刷新计数：用户刷新与静默刷新并发时，先结束的一方不能把标志提前复位
  let inFlightRefreshes = 0

  async function withRefreshFlag<T>(task: () => Promise<T>): Promise<T> {
    inFlightRefreshes += 1
    refreshFlag.value = true
    try {
      return await task()
    } finally {
      inFlightRefreshes -= 1
      if (inFlightRefreshes === 0) refreshFlag.value = false
    }
  }

  const key = computed<QueryKey>(() => toValue(options.key))

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => options.queryFn({ refresh: refreshFlag.value, signal }),
  })

  const loading = computed(() => query.isPending.value || (query.isFetching.value && query.data.value === undefined))

  // 读取失败即时反馈一次；重试由用户显式触发
  watch(query.error, (error) => {
    // 取消不是错误：切页 / 切换作用域会中断在飞请求，用户什么都没做，提示只会是噪音；
    // 超时是真实失败，码值在 transport 层已分流，照常提示。
    if (!error || isCanceledError(error)) return
    toast.error(errorMessage(error))
  })

  async function refresh() {
    if (refreshing.value) return
    refreshing.value = true
    const started = Date.now()
    try {
      const result = await withRefreshFlag(() => query.refetch())
      if (result.error) return
      const wait = Math.max(0, REFRESH_MIN_MS - (Date.now() - started))
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      const notice = options.refreshNotice ?? '已刷新'
      if (notice) toast.success(notice)
    } finally {
      if (dispose.value) refreshing.value = false
    }
  }

  /**
   * 静默强制刷新：与 refresh() 一样走 refresh=true 绕过服务端缓存，但不占用 refreshing、不弹提示。
   * 供「等待状态落定」这类自动轮询使用：轮询不该让顶部刷新按钮转圈，也不该每隔几秒弹一次「已刷新」。
   */
  async function refreshSilently() {
    await withRefreshFlag(() => query.refetch())
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
    refreshSilently,
    invalidate,
  }
}
