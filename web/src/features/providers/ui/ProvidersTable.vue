<script setup lang="ts">
import { EllipsisVertical, LoaderCircle, Settings2 } from '@lucide/vue'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableLoading, TableRow } from '@/shared/ui/table'
import { providerTypeLabel } from '../model/paths'
import type { Provider } from '../model/types'
import { providerConfigItems } from '../model/provider-config-items'

defineProps<{
  providers: Provider[]
  allProviders: Provider[]
  loading: boolean
  refreshing: boolean
  canEdit: boolean
  busy: (provider: Provider) => boolean
}>()

const emit = defineEmits<{
  test: [provider: Provider]
  edit: [provider: Provider]
  remove: [provider: Provider]
}>()
</script>

<template>
  <TableLoading :loading="loading" :refreshing="refreshing" :empty="!providers.length">
    <Table>
      <TableHeader class="bg-muted/50">
        <TableRow class="!border-0">
          <TableHead class="rounded-l-lg px-4">服务商</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>API 配置</TableHead>
          <TableHead class="rounded-r-lg w-12" />
        </TableRow>
      </TableHeader>
      <TableBody class="**:data-[slot=table-cell]:py-2.5">
        <TableRow v-if="!providers.length && !loading">
          <TableCell colspan="4" class="text-muted-foreground py-10 text-center">
            <div class="flex flex-col items-center justify-center gap-1.5 py-4">
              <Settings2 class="size-8 text-muted-foreground/40 stroke-1" />
              <div class="font-medium text-foreground/80 text-sm">暂无服务商</div>
              <div class="text-xs text-muted-foreground">点击右上角「新增服务商」开始配置 DNS / 隧道凭据</div>
            </div>
          </TableCell>
        </TableRow>
        <TableRow v-for="record in providers" :key="record.id">
          <TableCell class="px-4">
            <div class="font-medium">{{ record.name }}</div>
            <div class="text-muted-foreground max-w-[220px] truncate text-sm">{{ record.id }}</div>
          </TableCell>
          <TableCell
            ><Badge variant="secondary">{{ providerTypeLabel(record.type) }}</Badge></TableCell
          >
          <TableCell>
            <div class="flex max-w-md flex-wrap gap-1.5">
              <Badge
                v-for="item in providerConfigItems(record, allProviders)"
                :key="item.key"
                :variant="item.ok ? 'secondary' : 'outline'"
                class="max-w-full truncate font-normal"
                :title="item.value"
              >
                {{ item.value }}
              </Badge>
            </div>
          </TableCell>
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="size-8" :disabled="busy(record)">
                  <LoaderCircle v-if="busy(record)" class="size-4 animate-spin" />
                  <EllipsisVertical v-else class="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem :disabled="busy(record)" @click="emit('test', record)">测通</DropdownMenuItem>
                <DropdownMenuItem :disabled="busy(record) || !canEdit" @click="emit('edit', record)"
                  >更新</DropdownMenuItem
                >
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
