<script setup lang="ts">
import { computed } from 'vue'
import { statusMeta, statusTone } from '../lib/status'
import type { DerivedStatus, ReconcileSummary } from '../model/types'

const props = defineProps<{ summary: ReconcileSummary }>()

/** 状态卡片顺序固定；标签与色调取自 STATUS_META，卡片只负责计数与排版 */
const STATUS_KEYS: DerivedStatus[] = ['synced', 'drifted', 'missing', 'failed']

const cards = computed(() => [
  { key: 'total', label: '派生记录', value: props.summary.total, tone: 'text-foreground' },
  ...STATUS_KEYS.map((status) => ({
    key: status,
    label: statusMeta(status).label,
    value: props.summary[status],
    tone: statusTone(status),
  })),
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
