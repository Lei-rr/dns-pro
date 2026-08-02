import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

export function selectableRowKeys<T>(rows: T[], getKey: (row: T) => string, isBusy: (row: T) => boolean) {
  return rows
    .filter((row) => !isBusy(row))
    .map(getKey)
    .map(String)
    .filter((key) => key && key !== 'undefined' && key !== 'null')
}

export function selectedAvailableRows<T>(
  rows: T[],
  selectedKeys: string[],
  getKey: (row: T) => string,
  isBusy: (row: T) => boolean
) {
  const selected = new Set(selectedKeys)
  return rows.filter((row) => !isBusy(row) && selected.has(getKey(row)))
}

/** Row multi-select by stable string key. */
export function useRowSelection<T>(rows: MaybeRefOrGetter<T[]>, getKey: (row: T) => string) {
  const selected = ref<string[]>([])

  const list = computed<T[]>(() => toValue(rows) ?? [])

  function clear() {
    selected.value = []
  }

  watch(
    list,
    (next) => {
      const valid = new Set(next.map(getKey).map(String).filter(Boolean))
      selected.value = selected.value.filter((key) => valid.has(key))
    },
    { deep: false }
  )

  return { selected, clear }
}
