<script setup lang="ts">
import { cn } from '@/shared/lib/utils'
import type { HTMLAttributes } from 'vue'

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    title?: string
    description?: string
  }>(),
  {},
)
</script>

<template>
  <div :class="cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', props.class)">
    <div class="min-w-0 space-y-1">
      <h1 v-if="title" class="break-words text-xl font-semibold tracking-tight sm:text-2xl">{{ title }}</h1>
      <p v-if="description" class="text-muted-foreground break-words text-sm">{{ description }}</p>
      <slot name="title" />
    </div>
    <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
      <slot />
    </div>
  </div>
</template>
