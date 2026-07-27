import { ref } from 'vue'

/**
 * Single-row busy state for list actions (refresh / delete / status).
 * Prevents double-submit and lets the row show a spinner without full-table loading.
 */
export function useRowBusy() {
  const busyKey = ref('')

  function isBusy(key: string | number | null | undefined) {
    const k = String(key ?? '')
    return !!k && busyKey.value === k
  }

  async function runBusy(key: string | number | null | undefined, task: () => Promise<void>) {
    const k = String(key ?? '')
    if (!k || busyKey.value) return
    busyKey.value = k
    try {
      await task()
    } finally {
      if (busyKey.value === k) busyKey.value = ''
    }
  }

  return { busyKey, isBusy, runBusy }
}

/** Remove one item from a list by key; returns whether removed. */
export function removeListItem<T>(
  list: { value: T[] },
  match: (item: T) => boolean,
): boolean {
  const idx = list.value.findIndex(match)
  if (idx < 0) return false
  list.value = [...list.value.slice(0, idx), ...list.value.slice(idx + 1)]
  return true
}

/** Replace one item in a list by key. */
export function patchListItem<T>(
  list: { value: T[] },
  match: (item: T) => boolean,
  next: T,
): boolean {
  const idx = list.value.findIndex(match)
  if (idx < 0) return false
  const copy = list.value.slice()
  copy[idx] = next
  list.value = copy
  return true
}
