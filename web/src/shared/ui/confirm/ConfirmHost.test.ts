import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ConfirmHost from './ConfirmHost.vue'
import { confirmDeleteWithSkipCleanup, confirmDialog, confirmState, settleConfirm } from './confirm'

/**
 * 勾选项必须在界面上真正可达（缺陷本身是「参数支持但入口不存在」）：
 * 弹窗要渲染出勾选文案与勾选框，且勾选状态随确认一起回传。
 */

const wrappers: VueWrapper[] = []

async function flush() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function buttonsWithText(text: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((button) =>
    String(button.textContent ?? '').includes(text)
  )
}

afterEach(() => {
  if (confirmState.open.value) settleConfirm(false)
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('ConfirmHost 勾选项渲染', () => {
  it('渲染勾选文案与勾选框，勾选后点「删除」回传 checked=true', async () => {
    const wrapper = mount(ConfirmHost, { attachTo: document.body })
    wrappers.push(wrapper)

    const pending = confirmDeleteWithSkipCleanup('api.example.com')
    await flush()

    expect(document.body.textContent).toContain('跳过 DNS 清理：保留当前解析记录，稍后自行处理')
    expect(document.querySelectorAll('[data-slot="checkbox"]')).toHaveLength(1)
    expect(confirmState.optionChecked.value).toBe(false)

    // 点文案即可切换（不只是点小方框）
    buttonsWithText('跳过 DNS 清理')[0]?.click()
    await flush()
    expect(confirmState.optionChecked.value).toBe(true)

    buttonsWithText('删除')[0]?.click()
    await flush()
    await expect(pending).resolves.toEqual({ confirmed: true, checked: true })
  })

  it('不带勾选项的确认不渲染勾选框', async () => {
    const wrapper = mount(ConfirmHost, { attachTo: document.body })
    wrappers.push(wrapper)

    const pending = confirmDialog({ title: '确认', description: '继续？' })
    await flush()

    expect(document.querySelectorAll('[data-slot="checkbox"]')).toHaveLength(0)
    expect(document.body.textContent).toContain('继续？')

    settleConfirm(true)
    await expect(pending).resolves.toBe(true)
  })
})
