<script setup lang="ts">
import { EllipsisVertical } from '@lucide/vue'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Spinner } from '@/shared/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableLoading, TableRow } from '@/shared/ui/table'
import { edgeOneHttpsStatusLabel, edgeOneStatusLabel } from '@/features/edge-one/lib/status'
import type { EdgeOneAccelerationDomain } from '@/features/edge-one/model/types'
import { selectableRowKeys } from '@/shared/lib/row-selection'

const props = defineProps<{
  domains: EdgeOneAccelerationDomain[]
  loading: boolean
  refreshing: boolean
  selected: string[]
  domainName: (record: EdgeOneAccelerationDomain) => string
  busy: (record: EdgeOneAccelerationDomain) => boolean
}>()

const emit = defineEmits<{
  'update:selected': [keys: string[]]
  'repair-dns': [record: EdgeOneAccelerationDomain]
  edit: [record: EdgeOneAccelerationDomain]
  certificate: [record: EdgeOneAccelerationDomain]
  status: [record: EdgeOneAccelerationDomain, status: string]
  remove: [record: EdgeOneAccelerationDomain]
}>()

function selectedSet() {
  return new Set(props.selected)
}

function isSelected(record: EdgeOneAccelerationDomain) {
  return selectedSet().has(props.domainName(record))
}

function toggle(record: EdgeOneAccelerationDomain, checked: boolean) {
  const keys = selectedSet()
  const key = props.domainName(record)
  if (checked) keys.add(key)
  else keys.delete(key)
  emit('update:selected', [...keys])
}

function headerChecked(): boolean | 'indeterminate' {
  const selectable = props.domains.filter((record) => !props.busy(record))
  if (!selectable.length) return false
  const count = selectable.filter(isSelected).length
  return count === selectable.length ? true : count > 0 ? 'indeterminate' : false
}

function toggleAll(value: boolean | 'indeterminate') {
  emit('update:selected', value === true ? selectableRowKeys(props.domains, props.domainName, props.busy) : [])
}
</script>

<template>
  <TableLoading :loading="loading" :refreshing="refreshing" :empty="!domains.length">
    <Table>
      <TableHeader class="bg-muted/50">
        <TableRow class="!border-0">
          <TableHead class="w-10 rounded-l-lg px-3">
            <Checkbox :model-value="headerChecked()" aria-label="全选当前列表" @update:model-value="toggleAll" />
          </TableHead>
          <TableHead>加速域名</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>HTTPS</TableHead>
          <TableHead>CNAME</TableHead>
          <TableHead>源站</TableHead>
          <TableHead class="rounded-r-lg w-12" />
        </TableRow>
      </TableHeader>
      <TableBody class="**:data-[slot=table-cell]:py-2.5">
        <TableRow v-if="!domains.length && !loading">
          <TableCell colspan="7" class="text-muted-foreground py-10 text-center">暂无加速域名</TableCell>
        </TableRow>
        <TableRow v-for="record in domains" :key="domainName(record)" :class="busy(record) && 'bg-muted/40 opacity-80'">
          <TableCell class="px-3">
            <Checkbox
              :model-value="isSelected(record)"
              :disabled="busy(record)"
              @update:model-value="(value: boolean | 'indeterminate') => toggle(record, value === true)"
              @click.stop
            />
          </TableCell>
          <TableCell class="font-medium">{{ domainName(record) }}</TableCell>
          <TableCell
            ><Badge variant="secondary">{{ edgeOneStatusLabel(record.status) }}</Badge></TableCell
          >
          <TableCell
            ><Badge variant="secondary">{{ edgeOneHttpsStatusLabel(record.certificate) }}</Badge></TableCell
          >
          <TableCell class="max-w-[220px] truncate">{{ record.cname || '-' }}</TableCell>
          <TableCell class="max-w-[180px] truncate">{{ record.origin?.value || record.origin_type || '-' }}</TableCell>
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8" :disabled="busy(record)">
                  <Spinner v-if="busy(record)" class="size-4" />
                  <EllipsisVertical v-else class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem :disabled="busy(record)" @click="emit('repair-dns', record)"
                  >修复域名解析</DropdownMenuItem
                >
                <DropdownMenuItem :disabled="busy(record)" @click="emit('edit', record)">编辑</DropdownMenuItem>
                <DropdownMenuItem :disabled="busy(record)" @click="emit('certificate', record)"
                  >HTTPS 配置</DropdownMenuItem
                >
                <DropdownMenuItem :disabled="busy(record)" @click="emit('status', record, 'online')"
                  >启用</DropdownMenuItem
                >
                <DropdownMenuItem :disabled="busy(record)" @click="emit('status', record, 'offline')"
                  >停用</DropdownMenuItem
                >
                <DropdownMenuItem variant="destructive" :disabled="busy(record)" @click="emit('remove', record)"
                  >删除</DropdownMenuItem
                >
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </TableLoading>
</template>
