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

export type JobLike = {
  id?: string
  status?: string
  message?: string
  items?: Array<Record<string, unknown>>
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

export function failedLinesFromJob(job?: JobLike | null): string[] {
  return ((job?.items || []) as FailedJobItem[])
    .filter((i) => i.status === 'failed')
    .map((i) => formatFailedJobItem(i))
}

/**
 * 批量结果弹窗：
 * - 无失败 → toast 成功
 * - 有失败 → 弹窗展示失败列表；可点「重试失败项」
 * - 重试：onRetry 应完成「提交 + 轮询」并返回新 job；结果再次弹窗（不再只 toast「已提交」）
 */
export async function showBatchFailures(
  title: string,
  failures: string[],
  suffix = '条',
  options?: {
    /** 提交重试并轮询完成，返回最终 job（或 null） */
    onRetry?: () => void | Promise<JobLike | null | undefined>
    retryText?: string
    /** 重试后结果弹窗标题前缀，默认「重试结果」 */
    retryTitle?: string
  },
): Promise<void> {
  if (!failures.length) {
    toast.success(title)
    return
  }

  const preview = failures.slice(0, 8).join('\n')
  const more = failures.length > 8 ? `\n… 另有 ${failures.length - 8} ${suffix}` : ''
  const description = `失败 ${failures.length} ${suffix}\n\n${preview}${more}${
    options?.onRetry ? `\n\n是否${options.retryText || '重试失败项'}？` : ''
  }`

  if (!options?.onRetry) {
    await confirmDialog({
      title,
      description,
      confirmText: '知道了',
      cancelText: '关闭',
      destructive: false,
    })
    return
  }

  const ok = await confirmDialog({
    title,
    description,
    confirmText: options.retryText || '重试失败项',
    cancelText: '关闭',
    destructive: false,
  })
  if (!ok) return

  try {
    toast.loading('正在重试…')
    const job = (await options.onRetry()) as JobLike | null | undefined
    toast.dismiss()
    const retryFailed = failedLinesFromJob(job || null)
    const resultTitle = (job && job.message) || options.retryTitle || '重试结果'
    // 重试后仍失败：再弹一次（可继续重试）；成功则 toast
    if (retryFailed.length) {
      await showBatchFailures(resultTitle, retryFailed, suffix, {
        onRetry: options.onRetry,
        retryText: options.retryText,
        retryTitle: options.retryTitle,
      })
    } else {
      toast.success(resultTitle || '重试完成')
    }
  } catch (error) {
    toast.dismiss()
    toast.error(error instanceof Error ? error.message : String(error))
  }
}
