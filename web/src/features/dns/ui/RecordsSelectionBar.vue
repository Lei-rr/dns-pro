<script setup lang="ts">
import { Button } from '@/shared/ui/button'
import { FloatingSelectionBar } from '@/shared/ui/floating-selection-bar'

defineProps<{
  count: number
  show: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  clear: []
  edit: []
  remove: []
}>()
</script>

<template>
  <FloatingSelectionBar :show="show" :count="count" :disabled="disabled" @clear="emit('clear')">
    <Button size="sm" class="h-7 px-3 text-xs cursor-pointer" :disabled="disabled" @click="emit('edit')">
      批量管理
    </Button>
    <Button
      size="sm"
      variant="destructive"
      class="h-7 px-3 text-xs cursor-pointer"
      :disabled="disabled"
      @click="emit('remove')"
    >
      批量删除
    </Button>
  </FloatingSelectionBar>
</template>
