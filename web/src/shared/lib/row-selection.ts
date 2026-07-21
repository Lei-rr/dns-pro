import { computed, ref, unref, watch, type MaybeRefOrGetter, type Ref, toValue } from 'vue'

/** Row multi-select by stable string key. */
export function useRowSelection<T>(
  rows: MaybeRefOrGetter<T[]> | Ref<T[]>,
  getKey: (row: T) => string,
) {
  const selected = ref<string[]>([])

  const list = computed(() => {
    try {
      // Vue 3.5+ toValue; fallback unref
      return (typeof toValue === 'function' ? toValue(rows as any) : unref(rows as any)) as T[]
    } catch {
      return (unref(rows as any) || []) as T[]
    }
  })

  const keySet = computed(() => new Set(selected.value))
  const selectedRows = computed(() => list.value.filter((row) => keySet.value.has(getKey(row))))
  const allSelected = computed(
    () => list.value.length > 0 && list.value.every((row) => keySet.value.has(getKey(row))),
  )
  const someSelected = computed(
    () => list.value.some((row) => keySet.value.has(getKey(row))) && !allSelected.value,
  )
  const headerChecked = computed<boolean | 'indeterminate'>(() => {
    if (allSelected.value) return true
    if (someSelected.value) return 'indeterminate'
    return false
  })

  function isSelected(row: T) {
    return keySet.value.has(getKey(row))
  }

  function toggle(row: T, checked?: boolean) {
    const key = getKey(row)
    if (!key) return
    const on = checked ?? !keySet.value.has(key)
    if (on) {
      if (!keySet.value.has(key)) selected.value = [...selected.value, key]
    } else {
      selected.value = selected.value.filter((item) => item !== key)
    }
  }

  /** Header checkbox: always flip select-all / clear. */
  function toggleAll(checked?: boolean | 'indeterminate') {
    const on =
      checked === 'indeterminate' || checked === undefined
        ? !allSelected.value
        : Boolean(checked)
    selected.value = on
      ? list.value.map(getKey).map(String).filter((k) => k && k !== 'undefined' && k !== 'null')
      : []
  }

  function clear() {
    selected.value = []
  }

  watch(
    list,
    (next) => {
      const valid = new Set(next.map(getKey).map(String).filter(Boolean))
      selected.value = selected.value.filter((key) => valid.has(key))
    },
    { deep: false },
  )

  return {
    selected,
    selectedRows,
    allSelected,
    someSelected,
    headerChecked,
    isSelected,
    toggle,
    toggleAll,
    clear,
  }
}
