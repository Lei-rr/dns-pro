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

function onOpenChange(value: boolean) {
  if (!value) settleConfirm(false)
  else confirmState.open.value = true
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
        <AlertDialogCancel @click="settleConfirm(false)">
          {{ confirmState.options.value.cancelText }}
        </AlertDialogCancel>
        <AlertDialogAction :class="confirmClass" @click="settleConfirm(true)">
          {{ confirmState.options.value.confirmText }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
