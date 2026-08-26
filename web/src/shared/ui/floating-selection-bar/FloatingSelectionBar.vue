<script setup lang="ts">
import { Button } from '@/shared/ui/button'
import { Separator } from '@/shared/ui/separator'

defineProps<{
  show: boolean
  count: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  clear: []
}>()
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="transform translate-y-8 opacity-0"
    enter-to-class="transform translate-y-0 opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="transform translate-y-0 opacity-100"
    leave-to-class="transform translate-y-8 opacity-0"
  >
    <div
      v-if="show"
      data-slot="floating-selection-bar"
      class="pointer-events-none fixed bottom-5 inset-x-0 z-40 flex justify-center px-4"
    >
      <div
        class="bg-background/95 border-border/80 text-foreground pointer-events-auto flex max-w-lg flex-wrap items-center justify-center gap-2.5 rounded-full border px-4 py-2 shadow-xl backdrop-blur-md transition-all"
      >
        <div class="flex items-center gap-1.5 px-1 text-sm font-medium">
          <span
            class="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-[11px] font-bold"
          >
            {{ count }}
          </span>
          <span class="text-muted-foreground text-xs whitespace-nowrap">项已选</span>
        </div>

        <Separator orientation="vertical" class="h-4 bg-border/60" />

        <div class="flex items-center gap-1.5">
          <slot />
        </div>

        <Separator orientation="vertical" class="h-4 bg-border/60" />

        <Button
          size="sm"
          variant="ghost"
          class="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          :disabled="disabled"
          @click="emit('clear')"
        >
          取消
        </Button>
      </div>
    </div>
  </Transition>
</template>
