<template>
  <a-space size="small">
    <a-button type="link" size="small" :disabled="disabled" @click="$emit('edit')">编辑</a-button>
    <a-dropdown v-if="items.length">
      <a-button type="link" size="small" :disabled="disabled">更多</a-button>
      <template #overlay>
        <a-menu>
          <a-menu-item
            v-for="item in items"
            :key="item.key"
            :danger="!!item.danger"
            :disabled="!!item.disabled"
            @click="select(item)"
          >{{ item.label }}</a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </a-space>
</template>

<script setup lang="ts">
interface ActionItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
}

const props = defineProps<{
  items?: ActionItem[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'select', key: string): void
}>()

function select(item: ActionItem) {
  if (!props.disabled && !item.disabled) {
    emit('select', item.key)
  }
}
</script>
