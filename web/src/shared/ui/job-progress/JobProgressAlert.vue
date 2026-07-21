<script setup lang="ts">
import { computed } from 'vue'
import { Spinner } from '@/shared/ui/spinner'
import { Progress } from '@/shared/ui/progress'
import { cn } from '@/shared/lib/utils'

const props = withDefaults(
  defineProps<{
    running?: boolean
    text?: string
    title?: string
    description?: string
    status?: string
    percent?: number | null
    tone?: 'info' | 'warning'
    class?: string
  }>(),
  { tone: 'info', percent: null },
)

/** Only show when running OR real progress text — never fake default string. */
const visible = computed(() => Boolean(props.running || props.text))
const titleText = computed(() => props.title || props.text || '任务执行中…')
const progressValue = computed(() => {
  if (props.percent == null || Number.isNaN(Number(props.percent))) return null
  return Math.max(0, Math.min(100, Number(props.percent)))
})
</script>

<template>
  <div
    v-if="visible"
    :class="
      cn(
        'bg-card rounded-xl border px-3.5 py-3 text-sm shadow-xs',
        status === 'failed' && 'border-destructive/30',
        status === 'completed' && 'border-emerald-500/30',
        props.class,
      )
    "
    role="status"
  >
    <div class="flex items-start gap-2.5">
      <Spinner
        v-if="running && status !== 'completed' && status !== 'failed'"
        class="mt-0.5 shrink-0"
      />
      <div class="min-w-0 flex-1">
        <div class="font-medium">{{ titleText }}</div>
        <div v-if="description || (text && title)" class="text-muted-foreground mt-0.5 text-xs">
          {{ description || text }}
        </div>
        <Progress
          v-if="progressValue != null"
          class="mt-2.5 h-1.5"
          :model-value="progressValue"
        />
      </div>
    </div>
  </div>
</template>
