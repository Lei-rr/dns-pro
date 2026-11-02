import { ref, watch, type Ref } from 'vue'
import { usePageVisibility } from './use-page-visibility'
import { createScopeGeneration, type GenerationOwner } from './scope-generation'

interface StatusPollingConfig<T> {
  /** 待落定的项目 */
  pendingItems: Ref<Map<string, T>>
  /** 刷新数据源 */
  refresh: () => Promise<void>
  /** 检测限流错误 */
  checkRateLimit?: (error: unknown) => { retryAfterMs: number } | null
  /** 初始轮询间隔（毫秒） */
  initialDelayMs?: number
  /** 最大轮询间隔（毫秒） */
  maxDelayMs?: number
  /** 限流初始退避间隔（毫秒） */
  rateLimitInitialDelayMs?: number
  /** 限流最大退避间隔（毫秒） */
  rateLimitMaxDelayMs?: number
}

/**
 * 通用状态轮询逻辑：
 * - 仅在有待定项时轮询，无待定项时页面静止
 * - 页面不可见时停止，恢复可见时立即刷新
 * - 遇限流自动退避
 * - 代次隔离，防止并发轮询
 */
export function useStatusPolling<T>(config: StatusPollingConfig<T>) {
  const {
    pendingItems,
    refresh,
    checkRateLimit,
    initialDelayMs = 3000,
    maxDelayMs = 10000,
    rateLimitInitialDelayMs = 60000,
    rateLimitMaxDelayMs = 300000,
  } = config

  const { visible: pageVisible } = usePageVisibility()
  const generation = createScopeGeneration()

  let timer: ReturnType<typeof setTimeout> | null = null
  let delayMs = initialDelayMs
  let rateLimitDelayMs = 0
  let lastError = ref<unknown>(null)

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function nextDelayMs(current: number): number {
    return Math.min(current + 1000, maxDelayMs)
  }

  function nextRateLimitDelayMs(current: number, retryAfterMs?: number): number {
    const suggested = retryAfterMs ?? current * 2
    if (current === 0) return Math.max(suggested, rateLimitInitialDelayMs)
    return Math.min(suggested, rateLimitMaxDelayMs)
  }

  async function runPoll(owner: GenerationOwner) {
    if (!owner.active() || !pendingItems.value.size || !pageVisible.value) return

    clearTimer()

    try {
      await refresh()
      lastError.value = null
    } catch (error) {
      lastError.value = error
    }

    if (!owner.active() || !pendingItems.value.size || !pageVisible.value) return

    const rateLimit = checkRateLimit?.(lastError.value)
    if (rateLimit) {
      rateLimitDelayMs = nextRateLimitDelayMs(rateLimitDelayMs, rateLimit.retryAfterMs)
      timer = setTimeout(() => void runPoll(owner), rateLimitDelayMs)
      return
    }

    rateLimitDelayMs = 0
    timer = setTimeout(() => void runPoll(owner), delayMs)
    delayMs = nextDelayMs(delayMs)
  }

  function start() {
    clearTimer()
    delayMs = initialDelayMs
    rateLimitDelayMs = 0
    void runPoll(generation.claim())
  }

  function reset() {
    clearTimer()
    generation.invalidate()
    pendingItems.value = new Map()
    delayMs = initialDelayMs
    rateLimitDelayMs = 0
  }

  // 页面可见性切换：不可见时停止，恢复时立即刷新
  watch(pageVisible, (visible) => {
    if (visible && pendingItems.value.size) {
      void refresh()
      start()
    } else if (!visible) {
      clearTimer()
    }
  })

  // 待定项变化：从无到有启动轮询，从有到无停止轮询
  watch(
    () => pendingItems.value.size,
    (size, prevSize) => {
      if (size > 0 && prevSize === 0 && pageVisible.value) {
        start()
      } else if (size === 0 && prevSize > 0) {
        clearTimer()
      }
    }
  )

  return {
    start,
    reset,
    stop: clearTimer,
  }
}
