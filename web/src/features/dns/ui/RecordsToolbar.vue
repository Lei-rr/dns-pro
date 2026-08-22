<script setup lang="ts">
import { Download, RefreshCw, Search, Upload } from '@lucide/vue'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'

withDefaults(
  defineProps<{
    keyword: string
    typeFilter: string
    typeOptions: string[]
    loading?: boolean
    refreshing?: boolean
  }>(),
  {
    loading: false,
    refreshing: false,
  }
)

const emit = defineEmits<{
  'update:keyword': [value: string]
  search: []
  refresh: []
  'update:typeFilter': [value: string]
  export: [format: 'json' | 'csv' | 'zone']
  import: []
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
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="refreshing"
        :disabled="loading && !refreshing"
        @click="emit('refresh')"
      >
        <RefreshCw class="size-4" />
        刷新
      </LoadingButton>

      <div class="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" class="gap-1.5" @click="emit('import')">
          <Upload class="size-4" />
          导入
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm" class="gap-1.5">
              <Download class="size-4" />
              导出
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-36">
            <DropdownMenuItem @click="emit('export', 'csv')"> 导出为 CSV 表格 </DropdownMenuItem>
            <DropdownMenuItem @click="emit('export', 'json')"> 导出为 JSON 数据 </DropdownMenuItem>
            <DropdownMenuItem @click="emit('export', 'zone')"> 导出为 Zone 文本 </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        class="h-7 text-xs px-2.5"
        :variant="typeFilter === 'all' ? 'default' : 'outline'"
        @click="emit('update:typeFilter', 'all')"
      >
        全部
      </Button>
      <Button
        v-for="item in typeOptions"
        :key="item"
        size="sm"
        class="h-7 text-xs px-2.5"
        :variant="typeFilter === item ? 'default' : 'outline'"
        @click="emit('update:typeFilter', item)"
      >
        {{ item }}
      </Button>
    </div>
  </div>
</template>
