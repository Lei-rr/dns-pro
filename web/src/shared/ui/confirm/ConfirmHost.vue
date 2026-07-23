<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { buttonVariants } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import { confirmState, settleConfirm } from './confirm'

const confirmClass = computed(() =>
  cn(
    buttonVariants({
      variant: confirmState.options.value.destructive ? 'destructive' : 'default',
    }),
  ),
)

/**
 * reka AlertDialogAction = DialogClose：点确认会先关弹窗再/同时冒泡 click。
 * 若 @update:open(false) 同步 settle(false)，会冲掉 settle(true) → 看起来“确定没用”。
 * 取消关闭延后到 microtask，让确认 click 先 resolve。
 */
function onOpenChange(value: boolean) {
  if (value) {
    confirmState.open.value = true
    return
  }
  queueMicrotask(() => {
    if (confirmState.open.value || confirmState.hasPending()) {
      settleConfirm(false)
    }
  })
}

function onConfirm(e: Event) {
  e.preventDefault()
  settleConfirm(true)
}

function onCancel(e: Event) {
  e.preventDefault()
  settleConfirm(false)
}
</script>

<template>
  <AlertDialog :open="confirmState.open.value" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ confirmState.options.value.title }}</AlertDialogTitle>
        <AlertDialogDescription class="whitespace-pre-wrap">
          {{ confirmState.options.value.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="onCancel">
          {{ confirmState.options.value.cancelText }}
        </AlertDialogCancel>
        <AlertDialogAction :class="confirmClass" @click="onConfirm">
          {{ confirmState.options.value.confirmText }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
