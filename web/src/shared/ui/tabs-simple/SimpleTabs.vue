<script setup lang="ts">
import { cn } from '@/shared/lib/utils'

const model = defineModel<string>({ default: '' })

defineProps<{
  items: Array<{ key: string; label: string }>
  class?: string
}>()
</script>

<template>
  <div
    role="tablist"
    :class="cn('inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1', $props.class)"
  >
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="tab"
      :aria-selected="model === item.key"
      class="inline-flex h-7 items-center rounded-md px-3 text-sm font-medium transition-colors"
      :class="model === item.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      @click="model = item.key"
    >
      {{ item.label }}
    </button>
  </div>
</template>
