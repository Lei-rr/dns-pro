<script setup lang="ts">
import { computed } from 'vue'
import { EllipsisVertical } from '@lucide/vue'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Checkbox, SelectAllCheckbox } from '@/shared/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Spinner } from '@/shared/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableLoading, TableRow } from '@/shared/ui/table'
import { statusLabel, statusVariant } from '@/features/saas/lib/status'
import type { SaaSHostname } from '@/shared/types'

const props = defineProps<{
  hostnames: SaaSHostname[]
  selectedHostnames: string[]
  loading: boolean
  refreshing: boolean
  refreshingHostname: string
  preferredDomain: (record: SaaSHostname) => string
}>()

const emit = defineEmits<{
  'update:selectedHostnames': [hostnames: string[]]
  detail: [record: SaaSHostname]
  refresh: [record: SaaSHostname]
  edit: [record: SaaSHostname]
  remove: [record: SaaSHostname]
}>()

function hostnameKey(record: SaaSHostname) {
  return String(record.hostname || record.id || '')
}

const selected = computed(() => new Set(props.selectedHostnames))
const allSelected = computed(() => props.hostnames.length > 0 && props.hostnames.every((record) => selected.value.has(hostnameKey(record))))
const someSelected = computed(() => props.hostnames.some((record) => selected.value.has(hostnameKey(record))) && !allSelected.value)
const headerChecked = computed<boolean | 'indeterminate'>(() => allSelected.value ? true : someSelected.value ? 'indeterminate' : false)

function setSelected(record: SaaSHostname, next: boolean) {
  const key = hostnameKey(record)
  if (!key) return
  emit(
    'update:selectedHostnames',
    next ? [...new Set([...props.selectedHostnames, key])] : props.selectedHostnames.filter((item) => item !== key),
  )
}

function toggleAll() {
  emit('update:selectedHostnames', allSelected.value ? [] : props.hostnames.map(hostnameKey).filter(Boolean))
}

function isRefreshing(record: SaaSHostname) {
  return props.refreshingHostname === hostnameKey(record)
}
</script>

<template>
  <TableLoading :loading="loading" :refreshing="refreshing" :empty="!hostnames.length">
    <Table>
      <TableHeader class="bg-muted/50">
        <TableRow class="!border-0">
          <TableHead class="w-10 rounded-l-lg px-3">
            <SelectAllCheckbox :checked="headerChecked" aria-label="全选当前列表" @click="toggleAll" />
          </TableHead>
          <TableHead>主机名</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>证书</TableHead>
          <TableHead>回源</TableHead>
          <TableHead>优选域名</TableHead>
          <TableHead class="rounded-r-lg w-12" />
        </TableRow>
      </TableHeader>
      <TableBody class="**:data-[slot=table-cell]:py-2.5">
        <TableRow v-if="!hostnames.length && !loading">
          <TableCell colspan="7" class="text-muted-foreground py-10 text-center">暂无自定义主机名</TableCell>
        </TableRow>
        <TableRow v-for="record in hostnames" :key="hostnameKey(record)" :class="isRefreshing(record) && 'bg-muted/40 opacity-80'">
          <TableCell class="px-3">
            <Checkbox
              :model-value="selected.has(hostnameKey(record))"
              @update:model-value="(value: boolean | 'indeterminate') => setSelected(record, value === true)"
              @click.stop
            />
          </TableCell>
          <TableCell class="font-medium">
            <button type="button" class="table-link-ellipsis max-w-[220px] text-left hover:underline" :title="record.hostname" @click="emit('detail', record)">
              {{ record.hostname }}
            </button>
          </TableCell>
          <TableCell><Badge :variant="statusVariant(record.status)">{{ statusLabel(record.status) }}</Badge></TableCell>
          <TableCell><Badge :variant="statusVariant(record.ssl?.status)">{{ statusLabel(record.ssl?.status) }}</Badge></TableCell>
          <TableCell class="max-w-[180px] truncate">{{ record.custom_origin_server || '默认回源' }}</TableCell>
          <TableCell class="max-w-[160px] truncate" :title="preferredDomain(record) || undefined">{{ preferredDomain(record) || '—' }}</TableCell>
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8" :disabled="isRefreshing(record)">
                  <Spinner v-if="isRefreshing(record)" class="size-4" /><EllipsisVertical v-else class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @click="emit('detail', record)">详情</DropdownMenuItem>
                <DropdownMenuItem :disabled="isRefreshing(record)" @click="emit('refresh', record)">
                  <Spinner v-if="isRefreshing(record)" class="mr-2 size-3.5" />刷新
                </DropdownMenuItem>
                <DropdownMenuItem @click="emit('edit', record)">编辑</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" @click="emit('remove', record)">删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </TableLoading>
</template>
