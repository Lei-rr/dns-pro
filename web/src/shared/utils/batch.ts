import { h } from 'vue'
import { message, modal } from '@/shared/plugins/antDesignVue'

export function showBatchFailures(title: string, failures: string[], suffix = '条') {
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
}
