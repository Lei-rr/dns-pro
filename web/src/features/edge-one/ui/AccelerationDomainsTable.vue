<script setup lang="ts">
import { computed } from 'vue'
import { EllipsisVertical, Radar } from '@lucide/vue'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Spinner } from '@/shared/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableLoading, TableRow } from '@/shared/ui/table'
import {
  edgeOneHttpsStatusLabel,
  edgeOneHttpsVariant,
  edgeOneStatusLabel,
  edgeOneStatusVariant,
} from '@/features/edge-one/lib/status'
import { edgeOneDomainStatusActions } from '@/features/edge-one/model/domain-status-actions'
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
  stop: [record: EdgeOneAccelerationDomain]
  enable: [record: EdgeOneAccelerationDomain]
  remove: [record: EdgeOneAccelerationDomain]
}>()

/** 行内状态动作显隐：online 只给「停止加速」（不出现删除），offline 同时给「启用」与「删除」，process 两者都禁用 */
function statusActions(record: EdgeOneAccelerationDomain) {
  return edgeOneDomainStatusActions(record.status)
}

// 选择状态缓存为 computed：避免每次渲染/每行都重建 Set
const selectedSet = computed(() => new Set(props.selected))
const selectableDomains = computed(() => props.domains.filter((record) => !props.busy(record)))

function isSelected(record: EdgeOneAccelerationDomain) {
  return selectedSet.value.has(props.domainName(record))
}

function toggle(record: EdgeOneAccelerationDomain, checked: boolean) {
  const keys = new Set(selectedSet.value)
  const key = props.domainName(record)
  if (checked) keys.add(key)
  else keys.delete(key)
  emit('update:selected', [...keys])
}

const headerChecked = computed<boolean | 'indeterminate'>(() => {
  const selectable = selectableDomains.value
  if (!selectable.length) return false
  const count = selectable.filter((record) => selectedSet.value.has(props.domainName(record))).length
  return count === selectable.length ? true : count > 0 ? 'indeterminate' : false
})

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
            <Checkbox :model-value="headerChecked" aria-label="全选当前列表" @update:model-value="toggleAll" />
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
          <TableCell colspan="7" class="text-muted-foreground py-10 text-center">
            <div class="flex flex-col items-center justify-center gap-1.5 py-4">
              <Radar class="size-8 text-muted-foreground/40 stroke-1" />
              <div class="font-medium text-foreground/80 text-sm">暂无加速域名</div>
              <div class="text-xs text-muted-foreground">点击上方「添加域名」开始配置 EdgeOne 加速</div>
            </div>
          </TableCell>
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
            ><StatusBadge :variant="edgeOneStatusVariant(record.status)">{{
              edgeOneStatusLabel(record.status)
            }}</StatusBadge></TableCell
          >
          <TableCell
            ><StatusBadge :variant="edgeOneHttpsVariant(record.certificate)">{{
              edgeOneHttpsStatusLabel(record.certificate)
            }}</StatusBadge></TableCell
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
                <!-- 两步走删除：online 只给「停止加速」、不出现删除；offline 才同时给出「启用」与删除入口；process 期间两者都不可用 -->
                <DropdownMenuItem
                  v-if="statusActions(record).canStop || statusActions(record).configuring"
                  :disabled="busy(record) || statusActions(record).configuring"
                  @click="emit('stop', record)"
                  >停止加速</DropdownMenuItem
                >
                <DropdownMenuItem
                  v-if="statusActions(record).canEnable"
                  :disabled="busy(record)"
                  @click="emit('enable', record)"
                  >启用</DropdownMenuItem
                >
                <DropdownMenuItem
                  v-if="statusActions(record).canRemove || statusActions(record).configuring"
                  variant="destructive"
                  :disabled="busy(record) || statusActions(record).configuring"
                  @click="emit('remove', record)"
                  >删除</DropdownMenuItem
                >
                <DropdownMenuLabel
                  v-if="statusActions(record).configuring"
                  class="text-muted-foreground text-xs font-normal"
                  >配置中，暂不可操作</DropdownMenuLabel
                >
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </TableLoading>
</template>
