<script setup lang="ts">
import type { BadgeVariants } from '@/shared/ui/badge'
import { Badge } from '@/shared/ui/badge'

withDefaults(
  defineProps<{
    variant?: BadgeVariants['variant']
  }>(),
  { variant: 'secondary' }
)
</script>

<template>
  <Badge :variant="variant" class="min-w-16 justify-center">
    <slot />
  </Badge>
</template>
