import { onScopeDispose, ref } from 'vue'
import { toast } from '@/shared/lib/toast'

/** 「已复制」高亮的复位时长 */
const COPY_HIGHLIGHT_MS = 2000

type CopyMessages = { success: string; failure: string }

/**
 * 复制文本并在 COPY_HIGHLIGHT_MS 内保持高亮：copied 存调用方传入的标记（布尔或行下标），
 * 换行复制时只保留最新标记；计时器随作用域销毁清理，避免卸载后写已失效的 ref。
 */
export function useClipboardCopy() {
  const copied = ref<unknown>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearTimer() {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  onScopeDispose(clearTimer)

  async function copy(text: string, mark: unknown, messages: CopyMessages) {
    try {
      await navigator.clipboard.writeText(text)
      clearTimer()
      copied.value = mark
      timer = setTimeout(() => {
        copied.value = null
      }, COPY_HIGHLIGHT_MS)
      toast.success(messages.success)
    } catch {
      toast.warning(messages.failure)
    }
  }

  return { copied, copy }
}
