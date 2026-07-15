<template>
  <div class="page-toolbar">
    <div>
      <a-button v-if="backText" type="link" style="padding: 0" @click="$emit('back')">{{ backText }}</a-button>
      <a-typography-title :level="3" :style="backText ? { margin: '4px 0' } : { marginBottom: '4px' }">{{
        title
      }}</a-typography-title>
      <a-typography-text v-if="subtitle" type="secondary">{{ subtitle }}</a-typography-text>
    </div>
    <div class="page-actions">
      <a-input-search
        v-if="showSearch"
        :value="keyword"
        :style="searchWidth ? { width: searchWidth } : undefined"
        :placeholder="searchPlaceholder"
        allow-clear
        @update:value="$emit('update:keyword', $event)"
        @search="$emit('search')"
      />
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    backText?: string
    keyword?: string
    searchPlaceholder?: string
    showSearch?: boolean
    searchWidth?: string
  }>(),
  {
    // Records/Zones/EdgeOne toolbars rely on keyword search; keep the input visible by default.
    showSearch: true,
    searchPlaceholder: '搜索',
  },
)

defineEmits<{
  (e: 'update:keyword', value: string): void
  (e: 'search'): void
  (e: 'back'): void
}>()
</script>
