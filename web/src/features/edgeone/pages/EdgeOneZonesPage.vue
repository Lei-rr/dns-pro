<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, Search } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow, TableLoading } from '@/shared/ui/table'
import { edgeOneAccessLabel, edgeOneApi, edgeOneStatusLabel } from '@/features/edgeone/api/edgeone'
import { providerChildPath } from '@/features/providers/lib/paths'
import type { EdgeOneZone } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { handleRefresh, withMinLoading } from '@/shared/lib/loading'

const props = defineProps<{ providerId: string }>()
const router = useRouter()

const loading = ref(false)
const refreshing = ref(false)
const zones = ref<EdgeOneZone[]>([])
const keyword = ref('')

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return zones.value
  return zones.value.filter(
    (zone) =>
      String(zone.name || '').toLowerCase().includes(q) ||
      String(zone.id || '').toLowerCase().includes(q),
  )
})

async function load(options: { refresh?: boolean } = {}) {
  await withMinLoading(loading, async () => {
    try {
    const response = await edgeOneApi.zones(props.providerId, { refresh: options.refresh })
    zones.value = response.data || []
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
}

async function onRefresh() {
  refreshing.value = true
  try {
      await handleRefresh(loading, load, toast.success)
  } finally {
    refreshing.value = false
  }
}

function openZone(zone: EdgeOneZone) {
  // path second segment is zoneId for API; keep id, title page will resolve name
  router.push(providerChildPath(props.providerId, String(zone.id || zone.name)))
}

watch(
  () => props.providerId,
  () => load(),
)

onMounted(() => load())
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="EdgeOne" description="选择站点进入安全加速域名管理。">
      <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
        <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
        刷新
      </Button>
    </PageHeader>

    <div class="flex w-full flex-col gap-4">
      <div class="flex items-center gap-2">
        <Input v-model="keyword" class="h-8 w-full sm:w-64" placeholder="搜索站点" @keyup.enter="load()" />
        <Button variant="outline" size="sm" :loading="loading" @click="load()">
          <Search class="size-4" />
          搜索
        </Button>
      </div>

      <TableLoading :loading="loading" :empty="!filtered.length">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow class="!border-0">
              <TableHead class="rounded-l-lg px-4">站点</TableHead>
              <TableHead>站点 ID</TableHead>
              <TableHead>区域</TableHead>
              <TableHead>接入方式</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="rounded-r-lg text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody class="**:data-[slot=table-cell]:py-2.5">
            <TableRow v-if="!filtered.length && !loading">
              <TableCell colspan="6" class="text-muted-foreground py-10 text-center">暂无 EdgeOne 站点</TableCell>
            </TableRow>
            <TableRow v-for="zone in filtered" :key="String(zone.id || zone.name)">
              <TableCell class="px-4">
                <button class="font-medium hover:underline" @click="openZone(zone)">{{ zone.name }}</button>
              </TableCell>
              <TableCell class="max-w-[180px] truncate font-mono text-xs" :title="String(zone.id || '')">
                {{ zone.id || '-' }}
              </TableCell>
              <TableCell>{{ zone.area || '-' }}</TableCell>
              <TableCell>
                <Badge variant="outline">{{ edgeOneAccessLabel(zone.type) }}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{{ edgeOneStatusLabel(String(zone.active_status || zone.status || '')) }}</Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button variant="ghost" size="sm" @click="openZone(zone)">管理</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableLoading>
    </div>
  </div>
</template>
