<script setup lang="ts">
import { computed } from 'vue'
import type { ReconcileSummary } from '../model/types'

const props = defineProps<{ summary: ReconcileSummary }>()

const cards = computed(() => [
  { key: 'total', label: '派生记录', value: props.summary.total, tone: 'text-foreground' },
  { key: 'synced', label: '已同步', value: props.summary.synced, tone: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'drifted', label: '有漂移', value: props.summary.drifted, tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'missing', label: '缺失', value: props.summary.missing, tone: 'text-destructive' },
  { key: 'failed', label: '失败', value: props.summary.failed, tone: 'text-destructive' },
])
</script>

<template>
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
    <div v-for="card in cards" :key="card.key" class="bg-muted/40 rounded-xl px-4 py-3">
      <div class="text-muted-foreground text-xs font-medium">{{ card.label }}</div>
      <div class="mt-0.5 text-2xl font-bold tracking-tight tabular-nums" :class="card.tone">{{ card.value }}</div>
    </div>
  </div>
</template>
