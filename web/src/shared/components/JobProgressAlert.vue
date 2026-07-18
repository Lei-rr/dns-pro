<template>
  <a-alert
    v-if="visible"
    :type="alertType"
    show-icon
    style="margin-bottom: 12px"
    :message="titleText"
    :description="description || undefined"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * Shared long-running task banner (Ant Design a-alert only).
 * Use for batch / preferred-apply / import jobs — one look site-wide.
 */
const props = withDefaults(
  defineProps<{
    running?: boolean
    text?: string
    title?: string
    description?: string
    status?: string
    /** default warning while running (matches existing batch UX) */
    tone?: 'info' | 'warning'
  }>(),
  {
    tone: 'warning',
  },
)

const visible = computed(() => Boolean(props.running || props.text))
const titleText = computed(() => props.title || props.text || '任务执行中...')
const alertType = computed(() => {
  if (props.status === 'failed') return 'error'
  if (props.status === 'completed') return 'success'
  return props.tone
})
</script>
