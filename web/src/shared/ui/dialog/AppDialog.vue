<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import Dialog from './Dialog.vue'
import DialogContent from './DialogContent.vue'
import DialogDescription from './DialogDescription.vue'
import DialogFooter from './DialogFooter.vue'
import DialogHeader from './DialogHeader.vue'
import DialogTitle from './DialogTitle.vue'
import { cn } from '@/shared/lib/utils'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    title?: string
    description?: string
    class?: HTMLAttributes['class']
    contentClass?: HTMLAttributes['class']
    /** 禁止 Esc / 点击遮罩 / 关闭按钮关闭（用于必须完成的操作，如修改初始密码） */
    preventClose?: boolean
  }>(),
  { preventClose: false }
)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="!props.preventClose"
      @escape-key-down="props.preventClose && $event.preventDefault()"
      @pointer-down-outside="props.preventClose && $event.preventDefault()"
      :class="
        cn(
          'max-h-[calc(100svh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-4 sm:max-h-[calc(100svh-2rem)] sm:max-w-lg sm:p-6',
          props.contentClass || props.class
        )
      "
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
  </Dialog>
</template>
