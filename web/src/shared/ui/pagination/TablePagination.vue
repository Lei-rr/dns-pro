<script setup lang="ts">
import { computed } from 'vue'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/shared/ui/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { cn } from '@/shared/lib/utils'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

const props = withDefaults(
  defineProps<{
    page: number
    pageSize: number
    total: number
    class?: string
    disabled?: boolean
    pageSizeOptions?: number[]
  }>(),
  {
    page: 1,
    pageSize: 20,
    total: 0,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:page': [number]
  'update:pageSize': [number]
}>()

const sizeOptions = computed(() =>
  (props.pageSizeOptions?.length ? props.pageSizeOptions : [...PAGE_SIZE_OPTIONS]).slice(),
)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(Math.max(0, props.total) / Math.max(1, props.pageSize))),
)
const showPager = computed(() => props.total > 0)

function onPageChange(next: number) {
  if (props.disabled) return
  const page = Math.min(totalPages.value, Math.max(1, Number(next) || 1))
  if (page === props.page) return
  emit('update:page', page)
}

function onPageSizeChange(value: unknown) {
  if (props.disabled) return
  const next = Number(value)
  if (!Number.isFinite(next) || next <= 0 || next === props.pageSize) return
  emit('update:pageSize', next)
}
</script>

<template>
  <div
    v-if="showPager"
    :class="cn('flex flex-wrap items-center justify-end gap-2 border-t pt-2.5', props.class)"
  >
    <div class="text-muted-foreground flex items-center gap-1.5 text-xs">
      <span class="hidden sm:inline">每页</span>
      <Select
        :model-value="String(pageSize)"
        :disabled="disabled"
        @update:model-value="onPageSizeChange"
      >
        <SelectTrigger size="sm" class="h-8 w-[4.5rem] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="n in sizeOptions" :key="n" :value="String(n)">
            {{ n }}
          </SelectItem>
        </SelectContent>
      </Select>
      <span class="hidden sm:inline">条</span>
    </div>

    <Pagination
      v-slot="{ page: activePage }"
      :page="page"
      :items-per-page="pageSize"
      :total="total"
      :sibling-count="1"
      :show-edges="false"
      :disabled="disabled"
      class="mx-0 w-auto"
      @update:page="onPageChange"
    >
      <PaginationContent v-slot="{ items }" class="gap-0.5">
        <PaginationPrevious size="icon-sm" />
        <template v-for="(item, index) in items" :key="index">
          <PaginationItem
            v-if="item.type === 'page'"
            :value="item.value"
            :is-active="item.value === activePage"
            size="icon-sm"
            class="text-xs"
          >
            {{ item.value }}
          </PaginationItem>
          <PaginationEllipsis v-else :index="index" class="size-8" />
        </template>
        <PaginationNext size="icon-sm" />
      </PaginationContent>
    </Pagination>
  </div>
</template>
