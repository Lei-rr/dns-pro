<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground',
        success: 'border-transparent bg-emerald-100 text-emerald-700',
        warning: 'border-transparent bg-amber-100 text-amber-800',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  variant?: VariantProps<typeof badgeVariants>['variant']
}>(), { variant: 'default' })

const classes = computed(() => cn(badgeVariants({ variant: props.variant }), props.class))
</script>
<template>
  <span data-slot="badge" :class="classes"><slot /></span>
</template>
