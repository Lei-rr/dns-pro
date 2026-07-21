import { toast } from '@/shared/lib/toast'

type DnsOp = {
  status?: string
  message?: string
  [key: string]: unknown
} | null | undefined

/**
 * One combined toast for mutation + DNS writeback side effects.
 * Mutations must silent-reload afterwards (no second 「已刷新」).
 */
export function notifyDnsSideEffect(operation: DnsOp, successFallback: string) {
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
