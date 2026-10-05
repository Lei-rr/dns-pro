import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePageVisibility } from './use-page-visibility'

type VisibilityListener = () => void

/**
 * document 替身：本组合式函数只依赖 visibilityState 与 visibilitychange 的注册/移除，
 * 因此不引入真实 DOM 事件，直接记录监听器以便断言"作用域销毁后监听被移除"。
 */
function createDocumentMock(visibilityState: 'visible' | 'hidden') {
  const listeners = new Set<VisibilityListener>()
  const addEventListener = vi.fn((type: string, listener: VisibilityListener) => {
    if (type === 'visibilitychange') listeners.add(listener)
  })
  const removeEventListener = vi.fn((type: string, listener: VisibilityListener) => {
    if (type === 'visibilitychange') listeners.delete(listener)
  })
  return {
    document: { visibilityState, addEventListener, removeEventListener },
    listeners,
    addEventListener,
    removeEventListener,
    dispatchVisibilityChange() {
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 组合式函数依赖 onScopeDispose，必须跑在 effectScope 内（真实场景即组件 setup） */
function mountInScope() {
  const scope = effectScope()
  const state = scope.run(() => usePageVisibility())
  if (!state) throw new Error('usePageVisibility 未在作用域内返回状态')
  return { scope, visible: state.visible }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('页面可见性开关', () => {
  it('初始可见性取自 document.visibilityState', () => {
    const page = createDocumentMock('visible')
    vi.stubGlobal('document', page.document)
    const { scope, visible } = mountInScope()
    expect(visible.value).toBe(true)
    scope.stop()

    const hiddenPage = createDocumentMock('hidden')
    vi.stubGlobal('document', hiddenPage.document)
    const hiddenScope = mountInScope()
    expect(hiddenScope.visible.value).toBe(false)
    hiddenScope.scope.stop()
  })

  it('隐藏与恢复都会切换开关，且注册的是同一个监听函数', () => {
    const page = createDocumentMock('visible')
    vi.stubGlobal('document', page.document)
    const { scope, visible } = mountInScope()
    expect(page.addEventListener).toHaveBeenCalledTimes(1)
    expect(page.addEventListener.mock.calls[0]?.[0]).toBe('visibilitychange')

    page.document.visibilityState = 'hidden'
    page.dispatchVisibilityChange()
    expect(visible.value).toBe(false)

    page.document.visibilityState = 'visible'
    page.dispatchVisibilityChange()
    expect(visible.value).toBe(true)
    scope.stop()
  })

  it('作用域销毁后监听被移除：残留监听不再改变开关', () => {
    const page = createDocumentMock('visible')
    vi.stubGlobal('document', page.document)
    const { scope, visible } = mountInScope()
    const registered = page.addEventListener.mock.calls[0]?.[1]

    scope.stop()

    expect(page.removeEventListener).toHaveBeenCalledTimes(1)
    expect(page.removeEventListener).toHaveBeenCalledWith('visibilitychange', registered)
    expect(page.listeners.size).toBe(0)

    page.document.visibilityState = 'hidden'
    page.dispatchVisibilityChange()
    expect(visible.value).toBe(true)
  })

  it('非浏览器环境（SSR / 脚本）保守按可见处理，不注册监听', () => {
    const page = createDocumentMock('visible')
    vi.stubGlobal('document', undefined)
    const { scope, visible } = mountInScope()

    expect(visible.value).toBe(true)
    expect(page.addEventListener).not.toHaveBeenCalled()
    scope.stop()
  })
})
