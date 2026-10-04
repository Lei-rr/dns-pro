<script setup lang="ts">
import { Table, TableBody, TableCell, TableHead, TableHeader, TableLoading, TableRow } from '@/shared/ui/table'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ACTION_LABEL, sourceLabel, statusMeta } from '../lib/status'
import type { ReconcileItem } from '../model/types'

defineProps<{
  items: ReconcileItem[]
  loading?: boolean
  refreshing?: boolean
}>()

/** 期望值 / 当前值都按「类型 值」展示，便于一眼比对漂移 */
function describe(record: { type?: string; value?: string } | null | undefined) {
  if (!record) return '—'
  return `${record.type ?? ''} ${record.value ?? ''}`.trim() || '—'
}

/** 行标识：与后端 itemKey 同口径带上 purpose，同一主机名的 origin_cname 与 preferred_cname 不再撞 key */
function rowKey(item: ReconcileItem) {
  const { providerType, providerId, zone, fqdn } = item.target
  return [item.source.kind, item.source.id, providerType, providerId, zone, fqdn, item.purpose].join('|')
}
</script>

<template>
  <TableLoading
    :loading="Boolean(loading)"
    :empty="!items.length"
    :refreshing="Boolean(refreshing)"
    text="加载同步状态"
  >
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>来源</TableHead>
          <TableHead>目标记录</TableHead>
          <TableHead>当前值</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>处理</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="item in items" :key="rowKey(item)">
          <TableCell>
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium">{{ sourceLabel(item.source.kind) }}</span>
              <span class="text-muted-foreground truncate text-xs">{{ item.source.id }}</span>
            </div>
          </TableCell>
          <TableCell>
            <div class="flex flex-col gap-0.5">
              <span class="font-mono text-sm">{{ item.target.fqdn }}</span>
              <span class="text-muted-foreground text-xs">
                {{ item.target.providerType }} · {{ item.target.zone }} · {{ item.purpose }}
              </span>
            </div>
          </TableCell>
          <TableCell>
            <div class="flex flex-col gap-0.5">
              <span class="font-mono text-xs">{{ describe(item.desired.record) }}</span>
              <span v-if="item.current" class="text-muted-foreground font-mono text-xs">
                现：{{ describe(item.current.value) }}
              </span>
            </div>
          </TableCell>
          <TableCell>
            <StatusBadge :variant="statusMeta(item.status).variant">{{ statusMeta(item.status).label }}</StatusBadge>
          </TableCell>
          <TableCell>
            <div class="flex flex-col gap-0.5">
              <span class="text-xs">{{ ACTION_LABEL[item.action] ?? item.action }}</span>
              <span v-if="item.error" class="text-destructive truncate text-xs">{{ item.error }}</span>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </TableLoading>
</template>
