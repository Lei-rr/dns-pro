<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, Search } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableLoading } from '@/shared/ui/table'
import { edgeOneApi } from '@/features/edge-one/api/edge-one-api'
import { edgeOneAccessLabel, edgeOneStatusLabel } from '@/features/edge-one/lib/status'

import type { EdgeOneZone } from '@/features/edge-one/model/types'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { encodePath } from '@/shared/lib/path'

const props = defineProps<{ providerId: string }>()
const router = useRouter()

const zones = ref<EdgeOneZone[]>([])
const keyword = ref('')

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

const {
  loading,
  refreshing,
  pageSize,
  runLoad,
  onRefresh,
  onPageSizeChange: setPageSize,
  fail,
} = useListPage({
  pageSizeScope: 'edgeone-zones',
  load: async (options = {}) => {
    try {
      const response = await edgeOneApi.zones(props.providerId, { refresh: options.refresh })
      if (options.isLatest && !options.isLatest()) return false
      zones.value = response.data || []
      return true
    } catch (error) {
      if (!options.isLatest || options.isLatest()) fail(error)
      return false
    }
  },
})
const { page, total, pagedItems: pagedZones, resetPage } = useLocalPagination(filtered, pageSize)
watch(keyword, resetPage)

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
}

function openZone(zone: EdgeOneZone) {
  router.push(`/${encodePath(props.providerId)}/${encodePath(String(zone.id || zone.name))}`)
}

watch(
  () => props.providerId,
  () => {
    zones.value = []
    resetPage()
    void runLoad()
  }
)

onMounted(() => runLoad())
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="EdgeOne" description="选择站点进入安全加速域名管理。">
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="refreshing"
        :disabled="loading && !refreshing"
        @click="onRefresh()"
      >
        <RefreshCw class="size-4" />
        刷新
      </LoadingButton>
    </PageHeader>

    <div class="flex w-full flex-col gap-4">
      <div class="flex items-center gap-2">
        <Input v-model="keyword" class="h-8 w-full sm:w-64" placeholder="搜索站点" @keyup.enter="resetPage()" />
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
              <TableCell colspan="6" class="text-muted-foreground py-10 text-center">暂无 EdgeOne 站点</TableCell>
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
                <StatusBadge>{{ edgeOneStatusLabel(String(zone.active_status || zone.status || '')) }}</StatusBadge>
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
