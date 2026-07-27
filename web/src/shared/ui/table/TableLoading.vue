<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { cn } from '@/shared/lib/utils'
import { Spinner } from '@/shared/ui/spinner'

const props = withDefaults(
  defineProps<{
    loading?: boolean
    /** 兼容旧调用；空列表时 loading 立即反馈，有数据时延迟 soft 防闪 */
    empty?: boolean
    text?: string
    class?: string
    /** 有数据时延迟显示 soft-loading（ms） */
    delayMs?: number
  }>(),
  {
    loading: false,
    empty: false,
    text: '',
    delayMs: 120,
  },
)

/** 实际用于 UI 的 soft-loading，避免快请求闪一下 */
const soft = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
}

function syncSoft(loading: boolean, empty: boolean, delayMs: number) {
  clearTimer()
  if (!loading) {
    soft.value = false
    return
  }
  // 空列表：立刻反馈；有旧数据：延迟，快请求不闪
  if (empty || delayMs <= 0) {
    soft.value = true
    return
  }
  timer = setTimeout(() => {
    soft.value = true
    timer = null
  }, delayMs)
}

watch(
  () => [props.loading, props.empty, props.delayMs] as const,
  ([loading, empty, delayMs]) => {
    syncSoft(Boolean(loading), Boolean(empty), Number(delayMs ?? 120))
  },
  { immediate: true },
)

onBeforeUnmount(clearTimer)
</script>

<template>
  <!--
    列表 loading：
    - 有数据：轻暗 + 居中小 Spinner（无线性条、无「加载中…」文案）
    - 空列表：同样 soft，避免空白无反馈
    - 不整表替换成 loading 行（防布局跳）
  -->
  <div :class="cn('relative rounded-lg', props.class)">
    <div
      :class="cn(
        'transition-[opacity,filter] duration-200 ease-out',
        soft && 'pointer-events-none opacity-55',
      )"
      :aria-busy="loading || undefined"
    >
      <slot />
    </div>
    <div
      v-if="soft"
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      aria-hidden="true"
    >
      <div
        class="bg-background/80 text-foreground flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-sm backdrop-blur-[2px]"
      >
        <Spinner class="size-4" />
        <span v-if="text" class="text-muted-foreground text-xs">{{ text }}</span>
      </div>
    </div>
  </div>
</template>
