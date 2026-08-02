import { onScopeDispose, ref } from 'vue'
import { loadPageSize, savePageSize } from '@/shared/lib/page-size'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

type LoadContext = {
  refresh?: boolean
  isLatest?: () => boolean
}

type LoadFn = (options?: LoadContext) => Promise<boolean | void>
type LoadResult = { succeeded: boolean; isLatest: () => boolean }

/**
 * Shared list-page chrome: loading/refresh flags, pageSize memory, refresh action.
 * Feature pages still own their data fetch inside `load`.
 */
export function useListPage(options: { pageSizeScope: string; defaultPageSize?: number; load: LoadFn }) {
  const loading = ref(false)
  const refreshing = ref(false)
  const pageSize = ref(loadPageSize(options.pageSizeScope, options.defaultPageSize ?? 20))
  let requestVersion = 0

  let disposed = false
  onScopeDispose(() => {
    disposed = true
    requestVersion++
    loading.value = false
    refreshing.value = false
  })

  function nextLoad(refresh?: boolean) {
    const version = ++requestVersion
    const isLatest = () => !disposed && version === requestVersion
    return {
      isLatest,
      response: options.load({
        refresh,
        isLatest,
      }),
    }
  }

  async function trackedLoad(refresh?: boolean): Promise<LoadResult> {
    if (disposed) return { succeeded: false, isLatest: () => false }
    const load = nextLoad(refresh)
    loading.value = true
    try {
      return { succeeded: (await load.response) !== false, isLatest: load.isLatest }
    } finally {
      if (load.isLatest()) loading.value = false
    }
  }

  async function runLoad(opts: { refresh?: boolean } = {}) {
    // Only explicit user refresh actions pass refresh=true. Mutation follow-up reads stay cache-first.
    await trackedLoad(opts.refresh)
  }

  async function onRefresh() {
    if (refreshing.value || loading.value) return
    refreshing.value = true
    const started = Date.now()
    try {
      const load = await trackedLoad(true)
      if (!load.succeeded || !load.isLatest()) return
      const wait = Math.max(0, 120 - (Date.now() - started))
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      if (load.isLatest()) toast.success('已刷新')
    } finally {
      if (!disposed) refreshing.value = false
    }
  }

  function onPageSizeChange(next: number) {
    pageSize.value = next
    savePageSize(options.pageSizeScope, next)
  }

  function fail(error: unknown) {
    if (!disposed) toast.error(errorMessage(error))
  }

  function active() {
    return !disposed
  }

  return {
    loading,
    refreshing,
    pageSize,
    runLoad,
    onRefresh,
    onPageSizeChange,
    active,
    fail,
  }
}
