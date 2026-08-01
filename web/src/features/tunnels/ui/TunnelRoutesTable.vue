<script setup lang="ts">
import { EllipsisVertical } from '@lucide/vue'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Spinner } from '@/shared/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableLoading, TableRow } from '@/shared/ui/table'
import type { TunnelRoute } from '@/features/tunnels/model/types'

defineProps<{
  routes: TunnelRoute[]
  loading: boolean
  refreshing: boolean
  busy: (record: TunnelRoute) => boolean
}>()

const emit = defineEmits<{
  edit: [record: TunnelRoute]
  remove: [record: TunnelRoute]
}>()
</script>

<template>
  <TableLoading :loading="loading" :refreshing="refreshing" :empty="!routes.length">
    <Table>
      <TableHeader class="bg-muted/50">
        <TableRow class="!border-0">
          <TableHead class="rounded-l-lg px-4">Hostname</TableHead>
          <TableHead>Service</TableHead>
          <TableHead>Path</TableHead>
          <TableHead class="rounded-r-lg w-12" />
        </TableRow>
      </TableHeader>
      <TableBody class="**:data-[slot=table-cell]:py-2.5">
        <TableRow v-if="!routes.length && !loading">
          <TableCell colspan="4" class="text-muted-foreground py-10 text-center">暂无路由</TableCell>
        </TableRow>
        <TableRow
          v-for="(record, index) in routes"
          :key="`${record.hostname}-${record.path}-${index}`"
          :class="busy(record) && 'bg-muted/40 opacity-80'"
        >
          <TableCell class="px-4 font-medium">{{ record.hostname || '-' }}</TableCell>
          <TableCell class="max-w-[280px] truncate">{{ record.service || '-' }}</TableCell>
          <TableCell>{{ record.path || '/' }}</TableCell>
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8" :disabled="busy(record)">
                  <Spinner v-if="busy(record)" class="size-4" />
                  <EllipsisVertical v-else class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem :disabled="busy(record)" @click="emit('edit', record)">编辑</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" :disabled="busy(record)" @click="emit('remove', record)">
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </TableLoading>
</template>
