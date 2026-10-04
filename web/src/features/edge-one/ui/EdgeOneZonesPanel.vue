<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Radar, RefreshCw, Search, X } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableLoading } from '@/shared/ui/table'
import { edgeOneApi } from '@/features/edge-one/api/edge-one-api'
import { edgeOneAccessLabel, edgeOneStatusLabel, edgeOneStatusVariant } from '@/features/edge-one/lib/status'

import type { EdgeOneZone } from '@/features/edge-one/model/types'
import { useResourceQuery } from '@/shared/query'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { encodePath } from '@/shared/lib/path'

const props = defineProps<{ providerId: string }>()
const router = useRouter()

const keyword = ref('')

const zonesQuery = useResourceQuery<EdgeOneZone[]>({
  key: () => ['edgeone', 'zones', props.providerId],
  queryFn: async ({ refresh }) => (await edgeOneApi.zones(props.providerId, { refresh })).data || [],
  pageSizeScope: 'edgeone-zones',
})
const loading = zonesQuery.loading
const refreshing = zonesQuery.refreshing
const pageSize = zonesQuery.pageSize
const zones = computed(() => zonesQuery.data.value ?? [])

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return zones.value
  return zones.value.filter(
    (zone) =>
      String(zone.name || '')
        .toLowerCase()
        .includes(q) ||
      String(zone.id || '')
        .toLowerCase()
        .includes(q)
  )
})

const { page, total, pagedItems: pagedZones, resetPage } = useLocalPagination(filtered, pageSize)
watch(keyword, resetPage)

function onPageSizeChange(next: number) {
  zonesQuery.setPageSize(next)
  resetPage()
}

function openZone(zone: EdgeOneZone) {
  router.push(`/${encodePath(props.providerId)}/${encodePath(String(zone.id || zone.name))}`)
}

watch(
  () => props.providerId,
  () => {
    resetPage()
  }
)

function clearSearch() {
  keyword.value = ''
  resetPage()
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="EdgeOne" description="选择站点进入安全加速域名管理。">
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="refreshing"
        :disabled="loading && !refreshing"
        @click="zonesQuery.refresh()"
      >
        <RefreshCw class="size-4" />
        刷新
      </LoadingButton>
    </PageHeader>

    <div class="flex w-full flex-col gap-4">
      <div class="flex items-center gap-2 w-full sm:w-auto">
        <div class="relative w-full sm:w-64">
          <Input v-model="keyword" class="h-8 w-full pr-7" placeholder="搜索站点" @keyup.enter="resetPage()" />
          <button
            v-if="keyword"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            title="清空"
            @click="clearSearch"
          >
            <X class="size-3.5" />
          </button>
        </div>
        <Button variant="outline" size="sm" @click="resetPage()">
          <Search class="size-4" />
          搜索
        </Button>
      </div>

      <TableLoading :loading="loading" :refreshing="refreshing" :empty="!filtered.length">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow class="!border-0">
              <TableHead class="rounded-l-lg px-4">站点</TableHead>
              <TableHead>站点 ID</TableHead>
              <TableHead>区域</TableHead>
              <TableHead>接入方式</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="rounded-r-lg w-[6rem] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody class="**:data-[slot=table-cell]:py-2.5">
            <TableRow v-if="!filtered.length && !loading">
              <TableCell colspan="6" class="text-muted-foreground py-10 text-center">
                <div class="flex flex-col items-center justify-center gap-1.5 py-4">
                  <Radar class="size-8 text-muted-foreground/40 stroke-1" />
                  <div class="font-medium text-foreground/80 text-sm">暂无 EdgeOne 站点</div>
                  <div class="text-xs text-muted-foreground">未检测到关联站点，请在腾讯云控制台接入域名</div>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-for="zone in pagedZones" :key="String(zone.id || zone.name)">
              <TableCell class="px-4">
                <Button variant="link" class="h-auto px-0 py-0 font-medium" @click="openZone(zone)">{{
                  zone.name
                }}</Button>
              </TableCell>
              <TableCell class="max-w-[180px] truncate font-mono text-xs" :title="String(zone.id || '')">
                {{ zone.id || '-' }}
              </TableCell>
              <TableCell>{{ zone.area || '-' }}</TableCell>
              <TableCell>
                <StatusBadge>{{ edgeOneAccessLabel(zone.type) }}</StatusBadge>
              </TableCell>
              <TableCell>
                <StatusBadge :variant="edgeOneStatusVariant(String(zone.active_status || zone.status || ''))">{{
                  edgeOneStatusLabel(String(zone.active_status || zone.status || ''))
                }}</StatusBadge>
              </TableCell>
              <TableCell class="text-right">
                <Button variant="ghost" size="sm" @click="openZone(zone)">管理</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableLoading>
      <TablePagination
        :page="page"
        :page-size="pageSize"
        :total="total"
        :disabled="loading"
        @update:page="page = $event"
        @update:page-size="onPageSizeChange"
      />
    </div>
  </div>
</template>
