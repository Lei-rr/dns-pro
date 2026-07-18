import { h } from 'vue'
import { message, modal } from '@/shared/plugins/antDesignVue'

export type FailedJobItem = {
  status?: unknown
  message?: unknown
  hostname?: unknown
  name?: unknown
  type?: unknown
  record_id?: unknown
  [key: string]: unknown
}

export function formatFailedJobItem(item: FailedJobItem): string {
  const host = String(item.hostname || '').trim()
  if (host) return `${host}: ${item.message || '失败'}`
  const name = String(item.name || '').trim()
  const type = String(item.type || '').trim()
  const id = String(item.record_id || item.id || '').trim()
  const head = [name, type, id].filter(Boolean).join(' ')
  return `${head || '项目'}: ${item.message || '失败'}`
}

/**
 * Show failed items. Optionally offer one-click retry (preferred-apply / batch).
 * Keeps original compact style: ≤3 → toast; more → modal list.
 */
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
    message.success(title)
    return
  }

  if (!options?.onRetry) {
    if (failures.length <= 3) {
      message.warning(`${title}，失败 ${failures.length} ${suffix}：${failures.join('；')}`)
      return
    }
    modal.warning({
      title: `${title}，失败 ${failures.length} ${suffix}`,
      width: 720,
      content: h('div', { style: 'max-height: 360px; overflow: auto; white-space: pre-wrap' }, failures.join('\n')),
      okText: '知道了',
    })
    return
  }

  modal.confirm({
    title: `${title}，失败 ${failures.length} ${suffix}`,
    width: 720,
    content: h('div', { style: 'max-height: 360px; overflow: auto; white-space: pre-wrap' }, failures.join('\n')),
    okText: options.retryText || '重试失败项',
    cancelText: '关闭',
    onOk: () => options.onRetry?.(),
  })
}
