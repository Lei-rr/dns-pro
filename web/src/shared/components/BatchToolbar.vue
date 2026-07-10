<template>
  <div v-if="count" class="batch-toolbar" aria-live="polite">
    <span>已选择 {{ count }} 项</span>
    <a-space size="small">
      <a-button
        v-for="action in actions"
        :key="action.key"
        size="small"
        :type="action.type || 'default'"
        :danger="!!action.danger"
        :loading="!!action.loading"
        :disabled="deleting || !!action.disabled"
        @click="$emit('action', action.key)"
        >{{ action.label }}</a-button
      >
      <a-button
        size="small"
        danger
        :loading="deleting"
        :disabled="deleting || deleteDisabled"
        @click="$emit('delete')"
        >{{ deleteText }}</a-button
      >
      <a-button size="small" :disabled="deleting" @click="$emit('clear')">取消选择</a-button>
    </a-space>
  </div>
</template>

<script setup lang="ts">
interface BatchAction {
  key: string
  label: string
  type?: string
  danger?: boolean
  loading?: boolean
  disabled?: boolean
}

defineProps<{
  count?: number
  deleting?: boolean
  deleteDisabled?: boolean
  deleteText?: string
  actions?: BatchAction[]
}>()

defineEmits<{
  (e: 'delete'): void
  (e: 'clear'): void
  (e: 'action', key: string): void
}>()
</script>
