<script setup lang="ts">
import { cn } from '@/shared/lib/utils'
import type { HTMLAttributes } from 'vue'
const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
<template>
  <th :class="cn('text-foreground h-10 px-3 text-left align-middle font-medium whitespace-nowrap', props.class)"><slot /></th>
</template>
