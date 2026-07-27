<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableLoading } from '@/shared/ui/table'
import { TablePagination } from '@/shared/ui/pagination'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { EllipsisVertical, Plus, RefreshCw, Search } from '@lucide/vue'
import { dnsApi } from '@/features/dns/api/dns'
import { getCachedProvider, loadProviders } from '@/features/providers/stores/providers'
import { providerChildPath, providerTypeLabel } from '@/features/providers/lib/paths'
import type { Zone } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { removeListItem } from '@/shared/lib/row-busy'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'

const props = defineProps<{ providerId: string }>()
const route = useRoute()
const router = useRouter()

const zones = ref<Zone[]>([])
const keyword = ref('')
const page = ref(1)
const total = ref(0)
const showAdd = ref(false)
const adding = ref(false)
const domainInput = ref('')

const provider = computed(() => getCachedProvider(props.providerId))
const title = computed(() => provider.value?.name || props.providerId)

const { loading, refreshing, pageSize, runLoad, onRefresh, onPageSizeChange: setPageSize, fail } = useListPage({
  pageSizeScope: 'dns-zones',
  load: async (options = {}) => {
    try {
      const response = await dnsApi.zones(props.providerId, {
        page: page.value,
        per_page: pageSize.value,
        keyword: keyword.value,
        refresh: options.refresh,
      })
      zones.value = response.data || []
      const meta = (response as { meta?: Record<string, unknown> }).meta || {}
      const rawTotal = meta.total ?? meta.count
      total.value = Number(rawTotal != null && rawTotal !== '' ? rawTotal : zones.value.length || 0)
    } catch (error) {
      fail(error)
    }
  },
})
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return zones.value
  return zones.value.filter((zone) => String(zone.name || '').toLowerCase().includes(q))
})

async function ensureProvider() {
  if (!getCachedProvider(props.providerId)) {
    await loadProviders({ refresh: true })
  }
  if (!getCachedProvider(props.providerId)) {
    toast.warning('服务商不存在或未配置')
    router.replace('/')
  }
}

function onPageChange(next: number) {
  page.value = next
  void runLoad()
}

function onPageSizeChange(next: number) {
  setPageSize(next)
  page.value = 1
  void runLoad()
}

function onSearch() {
  page.value = 1
  void runLoad()
}

async function createZone() {
  const domain = domainInput.value.trim()
  if (!domain) {
    toast.warning('请输入域名')
    return
  }
  adding.value = true
  try {
    await dnsApi.createZone(props.providerId, { domain })
    toast.success('域名已添加')
    showAdd.value = false
    domainInput.value = ''
    await runLoad({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    adding.value = false
  }
}

function zoneRouteKey(zone: Zone) {
  // DNSPod/Cloudflare record APIs expect the apex domain name (e.g. guolei.cc),
  // not vendor numeric/hex zone ids.
  const name = String(zone.name || '').trim()
  if (name) return name
  return String(zone.id || '').trim()
}

async function removeZone(zone: Zone) {
  if (!(await confirmDelete(zone.name))) return
  try {
    await dnsApi.deleteZone(props.providerId, zoneRouteKey(zone))
    toast.success('已删除')
    removeListItem(zones, (item) => String(item.id || item.name) === String(zone.id || zone.name))
    if (total.value > 0) total.value -= 1
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function openRecords(zone: Zone) {
  router.push(providerChildPath(props.providerId, zoneRouteKey(zone)))
}

watch(
  () => props.providerId,
  async () => {
    page.value = 1
    await ensureProvider()
    await runLoad()
  },
)

onMounted(async () => {
  await ensureProvider()
  await runLoad()
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="title" :description="`${providerTypeLabel(provider?.type || '')} · 域名列表`">
      <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
        <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
        刷新
      </Button>
      <Button size="sm" @click="showAdd = true">
        <Plus class="size-4" />
        添加域名
      </Button>
    </PageHeader>

    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <Input v-model="keyword" class="h-8 w-full sm:w-64" placeholder="搜索域名" @keyup.enter="onSearch()" />
          <Button variant="outline" size="sm" :loading="loading" @click="onSearch()">
            <Search class="size-4" />
            搜索
          </Button>
        </div>
      </div>

      <TableLoading :loading="loading" :empty="!filtered.length">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow class="!border-0">
              <TableHead class="rounded-l-lg px-4">域名</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>类型</TableHead>
              <TableHead class="rounded-r-lg w-[7.5rem] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody class="**:data-[slot=table-cell]:py-2.5">
            <TableRow v-if="!filtered.length && !loading">
              <TableCell colspan="4" class="text-muted-foreground py-10 text-center">暂无域名</TableCell>
            </TableRow>
            <TableRow v-for="zone in filtered" :key="String(zone.id || zone.name)">
              <TableCell class="px-4">
                <button class="text-left font-medium hover:underline" @click="openRecords(zone)">
                  {{ zone.name }}
                </button>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{{ zone.access_status || zone.status || zone.dns_status || '-' }}</Badge>
              </TableCell>
              <TableCell class="text-muted-foreground">{{ provider?.type || '-' }}</TableCell>
              <TableCell class="text-right">
                <div class="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                  <Button variant="ghost" size="sm" @click="openRecords(zone)">管理</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" class="size-8">
                        <EllipsisVertical class="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" @click="removeZone(zone)">删除</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
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
        @update:page="onPageChange"
        @update:page-size="onPageSizeChange"
      />
    </div>

    <AppDialog v-model:open="showAdd" title="添加域名" description="创建后会同步到对应云服务商。">
      <FieldGroup>
        <Field>
          <FieldLabel>域名</FieldLabel>
          <Input v-model="domainInput" placeholder="example.com" @keyup.enter="createZone" />
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="showAdd = false">取消</Button>
        <Button :loading="adding" @click="createZone">添加</Button>
      </template>
    </AppDialog>
  </div>
</template>
