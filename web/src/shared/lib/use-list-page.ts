import { ref, type Ref } from 'vue'
import { handleRefresh, withMinLoading } from '@/shared/lib/loading'
import { loadPageSize, savePageSize } from '@/shared/lib/page-size'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

type LoadFn = (options?: { refresh?: boolean }) => Promise<void>

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

  async function runLoad(opts: { refresh?: boolean; silent?: boolean } = {}) {
    // Mutations often call runLoad({ refresh:true }) — keep table soft-load, but
    // allow silent:true to skip the global loading flag when patching a single row elsewhere.
    if (opts.silent) {
      await options.load(opts)
      return
    }
    await withMinLoading(loading, async () => {
      await options.load(opts)
    })
  }

  async function onRefresh() {
    if (refreshing.value || loading.value) return
    refreshing.value = true
    try {
      await handleRefresh(loading, options.load, toast.success)
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
