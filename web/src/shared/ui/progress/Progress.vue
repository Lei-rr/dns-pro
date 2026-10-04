<script setup lang="ts">
import { computed } from 'vue'
import type { ProgressRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ProgressIndicator, ProgressRoot } from 'reka-ui'
import { cn } from '@/shared/lib/utils'

const props = withDefaults(defineProps<ProgressRootProps & { class?: HTMLAttributes['class'] }>(), {
  modelValue: 0,
})

const delegatedProps = reactiveOmit(props, 'class')

// max 会随 delegatedProps 转发给 reka 的 ProgressRoot（无障碍语义按 max 计算），视觉位移必须同口径
const percent = computed(() => ((props.modelValue ?? 0) / (props.max || 100)) * 100)
</script>

<template>
  <ProgressRoot
    data-slot="progress"
    v-bind="delegatedProps"
    :class="cn('bg-primary/20 relative h-2 w-full overflow-hidden rounded-full', props.class)"
  >
    <ProgressIndicator
      data-slot="progress-indicator"
      class="bg-primary h-full w-full flex-1 transition-all"
      :style="`transform: translateX(-${100 - percent}%);`"
    />
  </ProgressRoot>
</template>
