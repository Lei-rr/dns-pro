<script setup lang="ts">
import { computed } from 'vue'
import { Check, Minus } from '@lucide/vue'
import { cn } from '@/shared/lib/utils'

const props = defineProps<{
  checked?: boolean | 'indeterminate'
  class?: string
}>()

const emit = defineEmits<{
  click: [MouseEvent]
}>()

const state = computed(() => {
  if (props.checked === true) return 'checked'
  if (props.checked === 'indeterminate') return 'indeterminate'
  return 'unchecked'
})
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="state === 'checked' ? 'true' : state === 'indeterminate' ? 'mixed' : 'false'"
    :data-state="state"
    :class="
      cn(
        'border-input peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs outline-none transition-colors',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
        state !== 'unchecked' && 'bg-primary border-primary text-primary-foreground',
        props.class,
      )
    "
    @click.stop.prevent="emit('click', $event)"
  >
    <Check v-if="state === 'checked'" class="size-3.5" />
    <Minus v-else-if="state === 'indeterminate'" class="size-3.5" />
  </button>
</template>
