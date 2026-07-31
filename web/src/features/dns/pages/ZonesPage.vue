<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { EllipsisVertical, Plus, RefreshCw, Search } from '@lucide/vue'
import { dnsApi } from '@/features/dns/api/dns'
import { getCachedProvider, loadProviders } from '@/features/providers/stores/providers'
import { providerChildPath, providerTypeLabel } from '@/features/providers/lib/paths'
import type { Zone } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors } from '@/shared/lib/field-errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { removeListItem } from '@/shared/lib/row-busy'
import { confirmDelete } from '@/shared/ui/confirm'

const props = defineProps<{ providerId: string }>()
const router = useRouter()

const zones = ref<Zone[]>([])
const keyword = ref('')
const showAdd = ref(false)
const adding = ref(false)
const domainInput = ref('')
const domainError = ref('')

const provider = computed(() => getCachedProvider(props.providerId))
const title = computed(() => provider.value?.name || props.providerId)

const { loading, refreshing, pageSize, runLoad, onRefresh, onPageSizeChange: setPageSize, fail } = useListPage({
  pageSizeScope: 'dns-zones',
  load: async (options = {}) => {
    try {
      const response = await dnsApi.zones(props.providerId, { refresh: options.refresh })
      if (options.isLatest && !options.isLatest()) return false
      zones.value = response.data || []
    } catch (error) {
      if (!options.isLatest || options.isLatest()) fail(error)
      return false
    }
  },
})
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return zones.value
  return zones.value.filter((zone) => String(zone.name || '').toLowerCase().includes(q))
})

const { page, total, pagedItems: pagedZones, resetPage } = useLocalPagination(filtered, pageSize)
watch(keyword, resetPage)

async function ensureProvider() {
  if (!getCachedProvider(props.providerId)) {
    await loadProviders({ force: true })
  }
  if (!getCachedProvider(props.providerId)) {
    toast.warning('服务商不存在或未配置')
    router.replace('/')
  }
}

function onPageChange(next: number) {
  page.value = next
}

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
}

function onSearch() {
  resetPage()
}

function openAdd() {
  domainError.value = ''
  showAdd.value = true
}

async function createZone() {
  const domain = domainInput.value.trim()
  domainError.value = domain ? '' : '请输入域名'
  if (domainError.value) return
  adding.value = true
  try {
    await dnsApi.createZone(props.providerId, { domain })
    toast.success('域名已添加')
    showAdd.value = false
    domainInput.value = ''
    await runLoad()
  } catch (error) {
    const fields = serverFieldErrors(error, { name: 'domain' })
    domainError.value = fields.domain || domainError.value
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
    resetPage()
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
      <Button variant="outline" size="sm" :loading="refreshing" :disabled="loading && !refreshing" @click="onRefresh()">
        <RefreshCw class="size-4" />
        刷新
      </Button>
      <Button size="sm" @click="openAdd">
        <Plus class="size-4" />
        添加域名
      </Button>
    </PageHeader>

    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <Input v-model="keyword" class="h-8 w-full sm:w-64" placeholder="搜索域名" @keyup.enter="onSearch()" />
          <Button variant="outline" size="sm" @click="onSearch()">
            <Search class="size-4" />
            搜索
          </Button>
        </div>
      </div>

      <TableLoading :loading="loading" :refreshing="refreshing" :empty="!filtered.length">
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
            <TableRow v-for="zone in pagedZones" :key="String(zone.id || zone.name)">
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
        <Field :data-invalid="!!domainError">
          <FieldLabel>域名</FieldLabel>
          <Input v-model="domainInput" placeholder="example.com" @keyup.enter="createZone" />
          <FieldError :errors="domainError ? [domainError] : []" />
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="showAdd = false">取消</Button>
        <Button :loading="adding" @click="createZone">添加</Button>
      </template>
    </AppDialog>
  </div>
</template>
