<template>
  <a-space size="small" :wrap="false" class="table-actions">
    <a-button
      v-if="primary"
      type="link"
      size="small"
      :disabled="disabled || !!primary.disabled"
      @click="emit('select', primary.key)"
      >{{ primary.label }}</a-button
    >
    <a-button v-else-if="showEdit" type="link" size="small" :disabled="disabled" @click="emit('edit')">编辑</a-button>

    <template v-for="item in inlineItems" :key="item.key">
      <a-button
        type="link"
        size="small"
        :danger="!!item.danger"
        :disabled="disabled || !!item.disabled"
        @click="select(item)"
        >{{ item.label }}</a-button
      >
    </template>

    <a-dropdown v-if="menuItems.length" :trigger="['click']" :get-popup-container="getPopupContainer">
      <a-button type="link" size="small" :disabled="disabled">更多</a-button>
      <template #overlay>
        <a-menu>
          <a-menu-item
            v-for="item in menuItems"
            :key="item.key"
            :danger="!!item.danger"
            :disabled="!!item.disabled"
            @click="select(item)"
            >{{ item.label }}</a-menu-item
          >
        </a-menu>
      </template>
    </a-dropdown>
  </a-space>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface ActionItem {
  key: string
  label: string
  danger?: boolean
  disabled?: boolean
  /** show as row-level link instead of dropdown */
  inline?: boolean
}

const props = withDefaults(
  defineProps<{
    /** primary action; if omitted and showEdit, emits edit */
    primary?: ActionItem | null
    items?: ActionItem[]
    disabled?: boolean
    showEdit?: boolean
  }>(),
  {
    showEdit: true,
  },
)

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'select', key: string): void
}>()

const actionItems = computed(() => props.items || [])
const inlineItems = computed(() => actionItems.value.filter((item) => item.inline))
const menuItems = computed(() => actionItems.value.filter((item) => !item.inline))

function getPopupContainer() {
  return document.body
}

function select(item: ActionItem) {
  if (!props.disabled && !item.disabled) {
    emit('select', item.key)
  }
}
</script>
