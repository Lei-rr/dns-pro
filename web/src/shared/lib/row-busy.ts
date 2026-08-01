import { computed, ref } from 'vue'
import { createScopeGeneration } from './scope-generation'

/**
 * Per-row operation ownership for list actions.
 * The same row is mutually exclusive; different rows may run concurrently.
 * A stale finally block can only release the token it acquired.
 */
export type RowOperationOwner = { active: () => boolean }

export function useRowBusy() {
  const operations = ref(new Map<string, symbol>())
  const busyKeys = computed(() => [...operations.value.keys()])
  const scopeGeneration = createScopeGeneration()

  function isBusy(key: string | number | null | undefined) {
    const k = String(key ?? '')
    return !!k && operations.value.has(k)
  }

  async function runBusy(key: string | number | null | undefined, task: (owner: RowOperationOwner) => Promise<void>) {
    const k = String(key ?? '')
    if (!k || operations.value.has(k)) return
    const token = Symbol(k)
    const scopeOwner = scopeGeneration.capture({})
    operations.value = new Map(operations.value).set(k, token)
    const active = () => scopeOwner.active() && operations.value.get(k) === token
    try {
      await task({ active })
    } finally {
      if (active()) {
        const next = new Map(operations.value)
        next.delete(k)
        operations.value = next
      }
    }
  }

  function reset() {
    scopeGeneration.invalidate()
    operations.value = new Map()
  }

  return { busyKeys, isBusy, runBusy, reset }
}

/** Remove one item from a list by key; returns whether removed. */
export function removeListItem<T>(list: { value: T[] }, match: (item: T) => boolean): boolean {
  const idx = list.value.findIndex(match)
  if (idx < 0) return false
  list.value = [...list.value.slice(0, idx), ...list.value.slice(idx + 1)]
  return true
}

/** Replace one item in a list by key. */
export function patchListItem<T>(
  list: { value: T[] },
  match: (item: T) => boolean,
  next: T | ((current: T) => T)
): boolean {
  const idx = list.value.findIndex(match)
  if (idx < 0) return false
  const copy = list.value.slice()
  copy[idx] = typeof next === 'function' ? (next as (current: T) => T)(copy[idx]) : next
  list.value = copy
  return true
}
