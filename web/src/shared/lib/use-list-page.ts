import { ref, type Ref } from 'vue'
import { loadPageSize, savePageSize } from '@/shared/lib/page-size'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

type LoadContext = {
  refresh?: boolean
  isLatest?: () => boolean
}

type LoadFn = (options?: LoadContext) => Promise<boolean | void>

/**
 * Shared list-page chrome: loading/refresh flags, pageSize memory, refresh action.
 * Feature pages still own their data fetch inside `load`.
 */
export function useListPage(options: {
  pageSizeScope: string
  defaultPageSize?: number
  load: LoadFn
}) {
  const loading = ref(false)
  const refreshing = ref(false)
  const pageSize = ref(loadPageSize(options.pageSizeScope, options.defaultPageSize ?? 20))
  let requestVersion = 0
  let activeLoads = 0

  function nextLoad(refresh?: boolean) {
    const version = ++requestVersion
    return options.load({
      refresh,
      isLatest: () => version === requestVersion,
    })
  }

  async function trackedLoad(refresh?: boolean) {
    activeLoads += 1
    loading.value = true
    try {
      return (await nextLoad(refresh)) !== false
    } finally {
      activeLoads -= 1
      loading.value = activeLoads > 0
    }
  }

  async function runLoad(opts: { refresh?: boolean; silent?: boolean } = {}) {
    // Only explicit user refresh actions pass refresh=true. Mutation follow-up reads stay cache-first;
    // backend invalidation makes them cold-load upstream exactly once.
    if (opts.silent) {
      await nextLoad(opts.refresh)
      return
    }
    await trackedLoad(opts.refresh)
  }

  async function onRefresh() {
    if (refreshing.value || loading.value) return
    refreshing.value = true
    const started = Date.now()
    try {
      const succeeded = await trackedLoad(true)
      if (!succeeded) return
      const wait = Math.max(0, 120 - (Date.now() - started))
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      toast.success('已刷新')
    } finally {
      refreshing.value = false
    }
  }

  function onPageSizeChange(next: number) {
    pageSize.value = next
    savePageSize(options.pageSizeScope, next)
  }

  function fail(error: unknown) {
    toast.error(errorMessage(error))
  }

  return {
    loading,
    refreshing,
    pageSize,
    runLoad,
    onRefresh,
    onPageSizeChange,
    fail,
  }
}

export type ListPageControls = {
  loading: Ref<boolean>
  refreshing: Ref<boolean>
  pageSize: Ref<number>
}
