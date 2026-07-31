<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { ButtonVariants } from '.'
import { Primitive } from 'reka-ui'
import { LoaderCircle } from '@lucide/vue'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '.'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
  /** Optional extension (not in upstream shadcn-vue). Only disables + aria-busy. */
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  loading: false,
  disabled: false,
  type: 'button',
})
</script>

<template>
  <!-- Keep width stable while exposing a visible loading state. -->
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :data-loading="loading ? 'true' : undefined"
    :as="as"
    :as-child="asChild"
    :type="asChild ? undefined : type"
    :disabled="asChild ? undefined : disabled || loading || undefined"
    :aria-busy="loading || undefined"
    :class="cn(buttonVariants({ variant, size }), 'relative', props.class)"
  >
    <slot v-if="asChild || !loading" />
    <template v-else>
      <LoaderCircle class="absolute size-4 animate-spin" aria-hidden="true" />
      <span class="flex items-center gap-[inherit] opacity-0"><slot /></span>
    </template>
  </Primitive>
</template>
