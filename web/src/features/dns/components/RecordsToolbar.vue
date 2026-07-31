<script setup lang="ts">
import { RefreshCw, Search } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'

withDefaults(defineProps<{
  keyword: string
  typeFilter: string
  typeOptions: string[]
  loading?: boolean
  refreshing?: boolean
}>(), {
  loading: false,
  refreshing: false,
})

const emit = defineEmits<{
  'update:keyword': [value: string]
  search: []
  refresh: []
  'update:typeFilter': [value: string]
}>()
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Input
        :model-value="keyword"
        class="h-8 w-full sm:w-72"
        placeholder="搜索主机 / 记录值"
        @update:model-value="emit('update:keyword', String($event))"
        @keyup.enter="emit('search')"
      />
      <Button variant="outline" size="sm" @click="emit('search')">
        <Search class="size-4" />
        搜索
      </Button>
      <Button variant="outline" size="sm" :loading="refreshing" :disabled="loading && !refreshing" @click="emit('refresh')">
        <RefreshCw class="size-4" />
        刷新
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        :variant="typeFilter === 'all' ? 'default' : 'outline'"
        @click="emit('update:typeFilter', 'all')"
      >
        全部
      </Button>
      <Button
        v-for="item in typeOptions"
        :key="item"
        size="sm"
        :variant="typeFilter === item ? 'default' : 'outline'"
        @click="emit('update:typeFilter', item)"
      >
        {{ item }}
      </Button>
    </div>
  </div>
</template>
