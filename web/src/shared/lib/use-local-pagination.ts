import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

/** Local pagination over a complete in-memory list. Never triggers network requests. */
export function useLocalPagination<T>(items: ComputedRef<T[]> | Ref<T[]>, pageSize: Ref<number>) {
  const page = ref(1)
  const total = computed(() => items.value.length)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const pagedItems = computed(() => {
    const start = (page.value - 1) * pageSize.value
    return items.value.slice(start, start + pageSize.value)
  })

  watch([total, pageSize], () => {
    if (page.value > totalPages.value) page.value = totalPages.value
  })

  function resetPage() {
    page.value = 1
  }

  return { page, total, totalPages, pagedItems, resetPage }
}
