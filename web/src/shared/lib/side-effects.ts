import { toast } from '@/shared/lib/toast'

type SideEffectOperation =
  | {
      status?: string
      message?: string
      [key: string]: unknown
    }
  | null
  | undefined

/**
 * One combined toast for mutation + DNS writeback side effects.
 * Mutations must silent-reload afterwards (no second 「已刷新」).
 */
export function notifyDnsSideEffect(operation: SideEffectOperation, successFallback: string) {
  if (!operation) {
    toast.success(successFallback)
    return
  }
  const text = String(operation.message || successFallback)
  if (operation.status === 'failed') {
    toast.warning(`${successFallback}，但 DNS 未成功：${text}`)
    return
  }
  if (operation.status === 'skipped') {
    toast.warning(`${successFallback}，DNS：${text}`)
    return
  }
  if (operation.message && operation.message !== successFallback) {
    toast.success(`${successFallback}（${operation.message}）`)
    return
  }
  toast.success(successFallback)
}

export function localPreferenceSideEffectFromData(response: unknown): SideEffectOperation {
  if (!response || typeof response !== 'object') return undefined
  const data = (response as { data?: unknown }).data
  if (!data || typeof data !== 'object') return undefined
  const sideEffects = (data as { side_effects?: unknown }).side_effects
  if (!sideEffects || typeof sideEffects !== 'object') return undefined
  const local = (sideEffects as { local?: unknown }).local
  if (!local || typeof local !== 'object') return undefined
  const preference = (local as { preference?: unknown }).preference
  return preference && typeof preference === 'object' ? (preference as NonNullable<SideEffectOperation>) : undefined
}
