import { confirmDialog } from '@/shared/ui/confirm'
import { toast } from '@/shared/lib/toast'

export type FailedJobItem = {
  status?: unknown
  message?: unknown
  hostname?: unknown
  name?: unknown
  type?: unknown
  record_id?: unknown
  domain?: unknown
  [key: string]: unknown
}

export function formatFailedJobItem(item: FailedJobItem): string {
  const host = String(item.hostname || item.domain || '').trim()
  if (host) return `${host}: ${item.message || '失败'}`
  const name = String(item.name || '').trim()
  const type = String(item.type || '').trim()
  const id = String(item.record_id || item.id || '').trim()
  const head = [name, type, id].filter(Boolean).join(' ')
  return `${head || '项目'}: ${item.message || '失败'}`
}

/** Compact failure report: ≤3 → toast; more → joined toast (no Ant modal). */
export function showBatchFailures(
  title: string,
  failures: string[],
  suffix = '条',
  options?: {
    onRetry?: () => void | Promise<void>
    retryText?: string
  },
) {
  if (!failures.length) {
    toast.success(title)
    return
  }

  const body =
    failures.length <= 3
      ? `${title}，失败 ${failures.length} ${suffix}：${failures.join('；')}`
      : `${title}，失败 ${failures.length} ${suffix}：${failures.slice(0, 5).join('；')}${failures.length > 5 ? '…' : ''}`

  toast.warning(body)

  if (options?.onRetry) {
    void confirmDialog({
      title,
      description: `失败 ${failures.length} ${suffix}\n\n是否${options.retryText || '重试失败项'}？`,
      confirmText: options.retryText || '重试失败项',
      cancelText: '关闭',
      destructive: false,
    }).then((ok) => { if (ok) void options.onRetry?.() })
  }
}
