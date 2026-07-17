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

const props = defineProps<{
  running?: boolean
  text?: string
  title?: string
  description?: string
  status?: string
}>()

const visible = computed(() => Boolean(props.running || props.text))
const titleText = computed(() => props.title || props.text || '任务执行中...')
const alertType = computed(() => {
  if (props.status === 'failed') return 'error'
  if (props.status === 'completed') return 'success'
  return 'info'
})
</script>
