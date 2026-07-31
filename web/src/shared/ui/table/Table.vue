<script setup lang="ts">
import { cn } from '@/shared/lib/utils'
import type { HTMLAttributes } from 'vue'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <div data-slot="table-container" :class="cn('relative w-full overflow-x-auto overscroll-x-contain', props.class)">
    <table class="w-full caption-bottom text-sm">
      <slot />
    </table>
  </div>
</template>
