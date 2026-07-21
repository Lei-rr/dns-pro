<script setup lang="ts">
import { cn } from '@/shared/lib/utils'

const props = withDefaults(
  defineProps<{
    loading?: boolean
    /** 兼容旧调用，不再展示任何「加载中」文案/Spinner */
    empty?: boolean
    text?: string
    class?: string
  }>(),
  {
    loading: false,
    empty: false,
    text: '',
  },
)
</script>

<template>
  <!-- 列表 loading：仅轻暗 + 禁点，无 Spinner、无「加载中…」文案 -->
  <div :class="cn('relative rounded-lg', props.class)">
    <div
      :class="cn(
        'transition-opacity duration-150',
        loading && 'pointer-events-none opacity-55',
      )"
    >
      <slot />
    </div>
  </div>
</template>
