<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { cn } from '@/shared/lib/utils'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    class?: HTMLAttributes['class']
    contentClass?: HTMLAttributes['class']
  }>(),
  {},
)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent
      :class="cn('max-h-[calc(100svh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-4 sm:max-h-[calc(100svh-2rem)] sm:max-w-lg sm:p-6', props.contentClass || props.class)"
    >
      <DialogHeader v-if="title || description || $slots.header">
        <slot name="header">
          <DialogTitle v-if="title">{{ title }}</DialogTitle>
          <DialogDescription v-if="description">{{ description }}</DialogDescription>
        </slot>
      </DialogHeader>

      <div class="min-h-0 touch-pan-y overflow-y-auto overscroll-contain px-0.5">
        <div class="grid gap-4">
        <slot />
        </div>
      </div>

      <DialogFooter v-if="$slots.footer">
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </DialogRoot>
</template>
