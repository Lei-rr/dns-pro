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
const resolvedStatus = computed(() => {
  if (props.status) return props.status
  if (props.running) return 'running'
  if (props.text) return 'completed'
  return ''
})
const progressValue = computed(() => {
  if (props.percent == null || Number.isNaN(Number(props.percent))) return null
  return Math.max(0, Math.min(100, Number(props.percent)))
})
const isTerminal = computed(
  () => resolvedStatus.value === 'completed' || resolvedStatus.value === 'failed' || (!props.running && !!props.text),
)
</script>

<template>
  <Transition name="job-progress-fade">
    <div
      v-if="visible"
      :class="
        cn(
          'bg-card rounded-xl border px-3.5 py-3 text-sm shadow-xs transition-opacity duration-300',
          resolvedStatus === 'failed' && 'border-destructive/30',
          (resolvedStatus === 'completed' || isTerminal) && resolvedStatus !== 'failed' && 'border-border/60 opacity-90',
          props.class,
        )
      "
      role="status"
    >
      <div class="flex items-start gap-2.5">
        <Spinner
          v-if="running && resolvedStatus !== 'completed' && resolvedStatus !== 'failed'"
          class="mt-0.5 shrink-0"
        />
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ titleText }}</div>
          <div v-if="description || (text && title)" class="text-muted-foreground mt-0.5 text-xs">
            {{ description || text }}
          </div>
          <Progress
            v-if="progressValue != null && running"
            class="mt-2.5 h-1.5"
            :model-value="progressValue"
          />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.job-progress-fade-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.job-progress-fade-leave-active {
  transition:
    opacity 0.45s ease,
    transform 0.45s ease;
}
.job-progress-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.job-progress-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
