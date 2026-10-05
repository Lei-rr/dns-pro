import { afterEach, describe, expect, it } from 'vitest'
import { confirmDeleteWithSkipCleanup, confirmDialog, confirmState, settleConfirm } from './confirm'

/**
 * 确认弹窗的勾选项：「删除时跳过 DNS 清理」（后端 auto_cleanup=false）此前无法从界面触达，
 * 这里钉住返回值语义——默认不勾（保持既有清理行为），勾选后调用方能拿到 checked=true。
 */

afterEach(() => {
  // 模块级单例：用例结束前把未决弹窗收尾，避免跨用例串状态
  if (confirmState.hasPending()) settleConfirm(false)
})

describe('确认弹窗的勾选项', () => {
  it('默认不勾选：确认后返回 checked=false，保持既有「删除并清理」行为', async () => {
    const pending = confirmDeleteWithSkipCleanup('api.example.com')

    expect(confirmState.open.value).toBe(true)
    expect(confirmState.optionChecked.value).toBe(false)
    expect(confirmState.options.value.option?.label).toContain('跳过 DNS 清理')

    settleConfirm(true)
    await expect(pending).resolves.toEqual({ confirmed: true, checked: false })
  })

  it('勾选后确认：返回 checked=true，调用方可据此下发 skipCleanup', async () => {
    const pending = confirmDeleteWithSkipCleanup('api.example.com')
    confirmState.optionChecked.value = true

    settleConfirm(true)
    await expect(pending).resolves.toEqual({ confirmed: true, checked: true })
  })

  it('取消：confirmed=false，勾选状态不被消费', async () => {
    const pending = confirmDeleteWithSkipCleanup('api.example.com')
    confirmState.optionChecked.value = true

    settleConfirm(false)
    await expect(pending).resolves.toEqual({ confirmed: false, checked: true })
  })

  it('不带勾选项的 confirmDialog 仍是布尔语义（既有调用点零改动）', async () => {
    const pending = confirmDialog({ title: '确认', description: '继续？' })

    expect(confirmState.options.value.option).toBeUndefined()
    settleConfirm(true)
    await expect(pending).resolves.toBe(true)
  })
})
