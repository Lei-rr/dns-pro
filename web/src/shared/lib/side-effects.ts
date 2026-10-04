import { toast } from '@/shared/lib/toast'

type DnsSideEffectKind = 'sync' | 'cleanup'

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
  return readSideEffect<NonNullable<SideEffectOperation>>(response, ['local', 'preference'])
}

/** 从接口响应的 data.side_effects 中读取指定路径的操作结果 */
function readSideEffect<T>(response: unknown, path: string[]): T | undefined {
  if (!response || typeof response !== 'object') return undefined
  const data = (response as { data?: unknown }).data
  if (!data || typeof data !== 'object') return undefined
  let current: unknown = (data as { side_effects?: unknown }).side_effects
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current && typeof current === 'object' ? (current as T) : undefined
}

/** DNS 写回/清理副作用（data.side_effects.dns.<kind>） */
export function dnsSideEffectFromData(response: unknown, kind: DnsSideEffectKind): SideEffectOperation {
  return readSideEffect<NonNullable<SideEffectOperation>>(response, ['dns', kind])
}
