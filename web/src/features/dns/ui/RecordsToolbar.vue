<script setup lang="ts">
import { Download, RefreshCw, Search, Upload, X } from '@lucide/vue'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
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

function clearKeyword() {
  emit('update:keyword', '')
  emit('search')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-full sm:w-72">
        <Input
          :model-value="keyword"
          class="h-8 w-full pr-7"
          placeholder="搜索主机 / 记录值"
          @update:model-value="emit('update:keyword', String($event))"
          @keyup.enter="emit('search')"
        />
        <button
          v-if="keyword"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
          title="清空"
          @click="clearKeyword"
        >
          <X class="size-3.5" />
        </button>
      </div>
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

    <div v-if="typeOptions.length" class="overflow-x-auto">
      <Tabs :model-value="typeFilter" @update:model-value="emit('update:typeFilter', String($event))">
        <TabsList class="h-8 w-max">
          <TabsTrigger value="all" class="text-xs px-3">全部</TabsTrigger>
          <TabsTrigger v-for="item in typeOptions" :key="item" :value="item" class="text-xs px-3">
            {{ item }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  </div>
</template>
