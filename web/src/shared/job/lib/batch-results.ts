import { confirmDialog } from '../../ui/confirm/confirm'
import { toast } from '../../lib/toast'
import type { JobItem, JobLike } from '../model/types'

export function formatFailedJobItem(item: JobItem): string {
  const host = String(item.hostname || item.domain || '').trim()
  if (host) return `${host}: ${item.message || '失败'}`
  const name = String(item.name || '').trim()
  const type = String(item.type || '').trim()
  const id = String(item.record_id || item.id || '').trim()
  const head = [name, type, id].filter(Boolean).join(' ')
  return `${head || '项目'}: ${item.message || '失败'}`
}

export function failedLinesFromJob(job?: JobLike | null): string[] {
  return (job?.items || []).filter((i) => i.status === 'failed').map((i) => formatFailedJobItem(i))
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
    /** 弹窗所属异步 scope；失效后确认、toast、递归弹窗均保持 inert。 */
    isActive?: () => boolean
  }
): Promise<void> {
  if (!failures.length) {
    if (options?.isActive?.() === false) return
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
  if (!ok || options.isActive?.() === false) return

  const toastId = toast.loading('正在重试…')
  try {
    const job = (await options.onRetry()) as JobLike | null | undefined
    toast.dismiss(toastId)
    if (options.isActive?.() === false) return
    const retryFailed = failedLinesFromJob(job || null)
    const resultTitle = (job && job.message) || options.retryTitle || '重试结果'
    // 重试后仍失败：再弹一次（可继续重试）；成功则 toast
    if (retryFailed.length) {
      await showBatchFailures(resultTitle, retryFailed, suffix, {
        onRetry: options.onRetry,
        retryText: options.retryText,
        retryTitle: options.retryTitle,
        isActive: options.isActive,
      })
    } else {
      toast.success(resultTitle || '重试完成')
    }
  } catch (error) {
    toast.dismiss(toastId)
    if (options.isActive?.() === false) return
    toast.error(error instanceof Error ? error.message : String(error))
  }
}
