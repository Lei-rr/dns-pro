<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, ChevronRight, Copy, EllipsisVertical } from '@lucide/vue'
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
import { orderedPurposeLabels } from '@/features/dns/lib/record-remark'
import {
  dnsRecordRowKey,
  dnsRecordTtlDisplay,
  type DnsRecordDisplayRow,
} from '@/features/dns/lib/record-display'
import type { DnsRecord } from '@/shared/types'

const props = defineProps<{
  rows: DnsRecordDisplayRow[]
  records: DnsRecord[]
  selectedKeys: string[]
  expandedHosts: Record<string, boolean>
  zoneName: string
  isCloudflare: boolean
  loading: boolean
  refreshing: boolean
  busy: (key: string) => boolean
}>()

const emit = defineEmits<{
  'update:selectedKeys': [keys: string[]]
  'update:expandedHosts': [hosts: Record<string, boolean>]
  edit: [record: DnsRecord]
  remove: [record: DnsRecord]
  copy: [record: DnsRecord]
}>()

const selected = computed(() => new Set(props.selectedKeys))
const allSelected = computed(() => props.records.length > 0 && props.records.every((record) => selected.value.has(dnsRecordRowKey(record))))
const someSelected = computed(() => props.records.some((record) => selected.value.has(dnsRecordRowKey(record))) && !allSelected.value)
const headerChecked = computed<boolean | 'indeterminate'>(() => allSelected.value ? true : someSelected.value ? 'indeterminate' : false)

function isSelected(record: DnsRecord) {
  return selected.value.has(dnsRecordRowKey(record))
}

function setSelected(record: DnsRecord, next: boolean) {
  const key = dnsRecordRowKey(record)
  emit('update:selectedKeys', next ? [...new Set([...props.selectedKeys, key])] : props.selectedKeys.filter((item) => item !== key))
}

function toggleAll() {
  emit('update:selectedKeys', allSelected.value ? [] : props.records.map(dnsRecordRowKey))
}

function groupAllSelected(records: DnsRecord[]) {
  return records.length > 0 && records.every(isSelected)
}

function groupSomeSelected(records: DnsRecord[]) {
  const count = records.filter(isSelected).length
  return count > 0 && count < records.length
}

function toggleGroup(records: DnsRecord[]) {
  const keys = new Set(props.selectedKeys)
  const select = !groupAllSelected(records)
  for (const record of records) {
    const key = dnsRecordRowKey(record)
    if (select) keys.add(key)
    else keys.delete(key)
  }
  emit('update:selectedKeys', [...keys])
}

function isExpanded(hostKey: string) {
  return props.expandedHosts[hostKey] === true
}

function toggleHost(hostKey: string) {
  emit('update:expandedHosts', { ...props.expandedHosts, [hostKey]: !isExpanded(hostKey) })
}

function purposeLabels(records: DnsRecord[]) {
  return orderedPurposeLabels(records, props.zoneName)
}

function recordValue(record: DnsRecord) {
  return String(record.value || record.content || '')
}
</script>

<template>
  <TableLoading :loading="loading" :refreshing="refreshing" :empty="!records.length">
    <Table>
      <TableHeader class="bg-muted/50">
        <TableRow class="!border-0">
          <TableHead class="w-10 rounded-l-lg px-3">
            <SelectAllCheckbox :checked="headerChecked" aria-label="全选当前列表" @click="toggleAll" />
          </TableHead>
          <TableHead class="w-[7rem] max-w-[7rem]">主机</TableHead>
          <TableHead class="w-[5.5rem]">类型</TableHead>
          <TableHead class="w-[14rem] max-w-[18rem]">记录值</TableHead>
          <TableHead class="w-[5rem]">TTL</TableHead>
          <TableHead class="w-[6rem]">线路</TableHead>
          <TableHead class="min-w-[6rem] max-w-[10rem]">备注</TableHead>
          <TableHead class="w-12 rounded-r-lg" />
        </TableRow>
      </TableHeader>
      <TableBody class="**:data-[slot=table-cell]:py-2.5">
        <TableRow v-if="!records.length && !loading">
          <TableCell colspan="8" class="text-muted-foreground py-10 text-center">暂无记录</TableCell>
        </TableRow>

        <template v-for="row in rows" :key="row.key">
          <TableRow v-if="row.kind === 'group'" class="bg-muted/30 hover:bg-muted/40">
            <TableCell class="px-3">
              <Checkbox
                :model-value="groupAllSelected(row.records) ? true : groupSomeSelected(row.records) ? 'indeterminate' : false"
                @update:model-value="() => toggleGroup(row.records)"
                @click.stop
              />
            </TableCell>
            <TableCell colspan="6" class="px-2">
              <button type="button" class="flex w-full min-w-0 items-center gap-2 text-left" @click="toggleHost(row.hostKey)">
                <ChevronDown v-if="isExpanded(row.hostKey)" class="text-muted-foreground size-4 shrink-0" />
                <ChevronRight v-else class="text-muted-foreground size-4 shrink-0" />
                <span class="min-w-0 truncate font-medium">{{ row.label }}</span>
                <span class="text-muted-foreground shrink-0 text-xs">{{ row.records.length }} 条</span>
                <span class="flex min-w-0 flex-wrap items-center gap-1">
                  <Badge v-for="label in purposeLabels(row.records)" :key="label" variant="outline" class="text-[11px] font-normal">
                    {{ label }}
                  </Badge>
                </span>
              </button>
            </TableCell>
            <TableCell class="w-12" />
          </TableRow>

          <TableRow
            v-for="record in row.kind === 'group' && isExpanded(row.hostKey) ? row.records : []"
            :key="dnsRecordRowKey(record)"
            class="bg-muted/10"
          >
            <TableCell class="px-3">
              <Checkbox :model-value="isSelected(record)" @update:model-value="(value: boolean | 'indeterminate') => setSelected(record, value === true)" @click.stop />
            </TableCell>
            <TableCell class="max-w-[7rem] truncate font-medium pl-8" :title="String(record.name || '@')">{{ record.name || '@' }}</TableCell>
            <TableCell><Badge variant="secondary">{{ record.type }}</Badge></TableCell>
            <TableCell class="w-[14rem] max-w-[18rem]">
              <div class="flex min-w-0 items-center gap-1">
                <div class="min-w-0 flex-1 truncate" :title="recordValue(record)">{{ recordValue(record) || '-' }}</div>
                <Button v-if="recordValue(record)" type="button" variant="ghost" size="icon" class="size-7 shrink-0" title="复制记录值" @click.stop="emit('copy', record)">
                  <Copy class="size-3.5" />
                </Button>
              </div>
            </TableCell>
            <TableCell>{{ dnsRecordTtlDisplay(record.ttl) }}</TableCell>
            <TableCell>
              <Badge v-if="isCloudflare" :variant="record.proxied ? 'default' : 'outline'">{{ record.proxied ? '代理' : '仅 DNS' }}</Badge>
              <template v-else>{{ record.line || '默认' }}</template>
            </TableCell>
            <TableCell><div class="text-muted-foreground max-w-[10rem] truncate text-sm" :title="String(record.remark || record.comment || '')">{{ record.remark || record.comment || '—' }}</div></TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon" class="size-8" :disabled="busy(dnsRecordRowKey(record))">
                    <Spinner v-if="busy(dnsRecordRowKey(record))" class="size-4" /><EllipsisVertical v-else class="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem :disabled="busy(dnsRecordRowKey(record))" @click="emit('edit', record)">编辑</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" :disabled="busy(dnsRecordRowKey(record))" @click="emit('remove', record)">删除</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>

          <TableRow v-if="row.kind === 'single'" :class="busy(dnsRecordRowKey(row.record)) && 'bg-muted/40 opacity-80'">
            <TableCell class="px-3"><Checkbox :model-value="isSelected(row.record)" @update:model-value="(value: boolean | 'indeterminate') => setSelected(row.record, value === true)" @click.stop /></TableCell>
            <TableCell class="max-w-[7rem] truncate font-medium" :title="String(row.record.name || '@')">{{ row.record.name || '@' }}</TableCell>
            <TableCell><Badge variant="secondary">{{ row.record.type }}</Badge></TableCell>
            <TableCell class="w-[14rem] max-w-[18rem]">
              <div class="flex min-w-0 items-center gap-1">
                <div class="min-w-0 flex-1 truncate" :title="recordValue(row.record)">{{ recordValue(row.record) || '-' }}</div>
                <Button v-if="recordValue(row.record)" type="button" variant="ghost" size="icon" class="size-7 shrink-0" title="复制记录值" @click.stop="emit('copy', row.record)"><Copy class="size-3.5" /></Button>
              </div>
            </TableCell>
            <TableCell>{{ dnsRecordTtlDisplay(row.record.ttl) }}</TableCell>
            <TableCell><Badge v-if="isCloudflare" :variant="row.record.proxied ? 'default' : 'outline'">{{ row.record.proxied ? '代理' : '仅 DNS' }}</Badge><template v-else>{{ row.record.line || '默认' }}</template></TableCell>
            <TableCell><div class="text-muted-foreground max-w-[10rem] truncate text-sm" :title="String(row.record.remark || row.record.comment || '')">{{ row.record.remark || row.record.comment || '—' }}</div></TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="size-8" :disabled="busy(dnsRecordRowKey(row.record))"><Spinner v-if="busy(dnsRecordRowKey(row.record))" class="size-4" /><EllipsisVertical v-else class="size-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuItem :disabled="busy(dnsRecordRowKey(row.record))" @click="emit('edit', row.record)">编辑</DropdownMenuItem><DropdownMenuItem variant="destructive" :disabled="busy(dnsRecordRowKey(row.record))" @click="emit('remove', row.record)">删除</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
    </Table>
  </TableLoading>
</template>
