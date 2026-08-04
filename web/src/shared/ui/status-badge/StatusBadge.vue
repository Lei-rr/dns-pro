<script setup lang="ts">
import { Badge } from '@/shared/ui/badge'

withDefaults(
  defineProps<{
    variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning'
  }>(),
  { variant: 'secondary' }
)
</script>

<template>
  <Badge :variant="variant" class="min-w-16 justify-center">
    <slot />
  </Badge>
</template>
