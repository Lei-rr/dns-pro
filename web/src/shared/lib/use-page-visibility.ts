import { onScopeDispose, ref, type Ref } from 'vue'

/** 非浏览器环境（SSR / 脚本）保守按可见处理：不制造虚假暂停，避免定时副作用被静默关掉 */
function readPageVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

/**
 * 页面可见性开关：以「用户在看页面」为前提的轮询/定时副作用据此暂停与恢复。
 * 监听注册在调用方的组件作用域上，作用域销毁时自动移除。
 */
export function usePageVisibility(): { visible: Ref<boolean> } {
  const visible = ref(readPageVisible())

  if (typeof document !== 'undefined') {
    const onVisibilityChange = () => {
      visible.value = readPageVisible()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    onScopeDispose(() => document.removeEventListener('visibilitychange', onVisibilityChange))
  }

  return { visible }
}
