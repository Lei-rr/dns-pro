<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Copy, EllipsisVertical, Plus, RefreshCw } from '@lucide/vue'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow, TableLoading } from '@/shared/ui/table'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { cloudflaredApi } from '@/features/cloudflared/api/cloudflared'
import { tunnelStatusLabel } from '@/features/cloudflared/lib/status'
import { providerPath } from '@/features/providers/lib/paths'
import type { CloudflaredRoute, CloudflaredTunnel } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { useRowBusy, removeListItem } from '@/shared/lib/row-busy'
import { Spinner } from '@/shared/ui/spinner'
import TunnelInstallPanel from '@/features/cloudflared/components/TunnelInstallPanel.vue'
import { confirmDelete } from '@/shared/ui/confirm'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { serverFieldErrors } from '@/shared/lib/field-errors'

const props = defineProps<{ providerId: string; tunnelId: string }>()
const { isBusy: isRowBusy, runBusy } = useRowBusy()
function routeKey(record: CloudflaredRoute) {
  return `${record.hostname || ''}|${record.path || ''}`
}
const router = useRouter()

const saving = ref(false)
const tunnel = ref<CloudflaredTunnel | null>(null)
const routes = ref<CloudflaredRoute[]>([])
const token = ref('')
const dialogOpen = ref(false)
const editingRoute = ref<CloudflaredRoute | null>(null)
const routeErrors = ref<Record<string, string>>({})
const form = reactive({
  hostname: '',
  service: 'http://localhost:8080',
  path: '',
})

const title = computed(() => tunnel.value?.name || props.tunnelId)

const { loading, refreshing, pageSize, runLoad, onRefresh, onPageSizeChange: setPageSize, fail } = useListPage({
  pageSizeScope: 'cloudflared-detail',
  load: async (options = {}) => {
    try {
      const [tunnelRes, routesRes, tokenRes] = await Promise.all([
        cloudflaredApi.tunnel(props.providerId, props.tunnelId, { refresh: options.refresh }),
        cloudflaredApi.routes(props.providerId, props.tunnelId, { refresh: options.refresh }),
        cloudflaredApi.tunnelToken(props.providerId, props.tunnelId).catch(() => null),
      ])
      if (options.isLatest && !options.isLatest()) return false
      tunnel.value = tunnelRes.data
      routes.value = routesRes.data?.routes || []
      token.value = tokenRes?.data?.token || ''
    } catch (error) {
      if (!options.isLatest || options.isLatest()) fail(error)
      return false
    }
  },
})
const routeItems = computed(() => routes.value)
const { page, total, pagedItems: pagedRoutes, resetPage } = useLocalPagination(routeItems, pageSize)

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
}

function openCreate() {
  editingRoute.value = null
  form.hostname = ''
  form.service = 'http://localhost:8080'
  form.path = ''
  routeErrors.value = {}
  dialogOpen.value = true
}

function openEditRoute(record: CloudflaredRoute) {
  editingRoute.value = record
  form.hostname = String(record.hostname || '')
  form.service = String(record.service || 'http://localhost:8080')
  form.path = String(record.path || '')
  routeErrors.value = {}
  dialogOpen.value = true
}

async function saveRoute() {
  routeErrors.value = {}
  if (!form.hostname.trim()) routeErrors.value.hostname = '请填写 Hostname'
  if (!form.service.trim()) routeErrors.value.service = '请填写 Service'
  if (Object.keys(routeErrors.value).length) return
  saving.value = true
  try {
    const data = {
      hostname: form.hostname.trim(),
      service: form.service.trim(),
      path: form.path.trim() || undefined,
    }
    if (editingRoute.value) {
      const response = await cloudflaredApi.updateRoute(
        props.providerId,
        props.tunnelId,
        data,
        String(editingRoute.value.hostname || ''),
        String(editingRoute.value.path || ''),
      )
      notifyDnsSideEffect(response.data?.side_effects?.dns?.sync, '路由已更新')
    } else {
      const response = await cloudflaredApi.addRoute(props.providerId, props.tunnelId, data)
      notifyDnsSideEffect(response.data?.side_effects?.dns?.sync, '路由已添加')
    }
    dialogOpen.value = false
    await runLoad()
  } catch (error) {
    routeErrors.value = { ...routeErrors.value, ...serverFieldErrors(error) }
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function removeRoute(record: CloudflaredRoute) {
  if (!(await confirmDelete(String(record.hostname || '')))) return
  const key = routeKey(record)
  await runBusy(key, async () => {
    try {
      const response = await cloudflaredApi.deleteRoute(
        props.providerId,
        props.tunnelId,
        String(record.hostname || ''),
        String(record.path || ''),
      )
      notifyDnsSideEffect(response.data?.side_effects?.dns?.cleanup, '已删除')
      removeListItem(routes, (item) => routeKey(item) === key)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
}

async function rotateToken() {
  try {
    const response = await cloudflaredApi.rotateToken(props.providerId, props.tunnelId)
    token.value = response.data?.token || ''
    toast.success('Token 已轮换')
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function copyToken() {
  if (!token.value) return
  try {
    await navigator.clipboard.writeText(token.value)
    toast.success('Token 已复制')
  } catch {
    toast.warning('复制失败，请手动选择复制')
  }
}

watch(
  () => [props.providerId, props.tunnelId],
  () => runLoad(),
)

onMounted(() => runLoad())
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="title" :description="`状态：${tunnelStatusLabel(tunnel?.status)} · Cloudflare Tunnel`">
    <Button variant="outline" size="sm" @click="router.push(providerPath(providerId))">返回隧道列表</Button>
    <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
      <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
      刷新
    </Button>
    <Button size="sm" @click="openCreate">
      <Plus class="size-4" />
      添加路由
    </Button>
    </PageHeader>

    <!-- Overview cards -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <div class="rounded-lg border bg-card p-4">
      <div class="text-muted-foreground text-xs">活动副本</div>
      <div class="mt-1 text-2xl font-semibold">{{ tunnel?.connections?.length || 0 }}</div>
    </div>
    <div class="rounded-lg border bg-card p-4">
      <div class="text-muted-foreground text-xs">路由</div>
      <div class="mt-1 text-2xl font-semibold">{{ routes.length }}</div>
    </div>
    <div class="rounded-lg border bg-card p-4">
      <div class="text-muted-foreground text-xs">状态</div>
      <div class="mt-1">
        <Badge>{{ tunnelStatusLabel(tunnel?.status) }}</Badge>
      </div>
    </div>
    <div class="rounded-lg border bg-card p-4">
      <div class="text-muted-foreground text-xs">隧道 ID</div>
      <div class="text-muted-foreground mt-1 truncate text-sm font-mono">{{ tunnel?.id || '-' }}</div>
    </div>
    </div>

    <div class="space-y-3 rounded-lg bg-muted/30 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-sm font-medium">安装 Token</div>
          <div class="text-muted-foreground mt-1 max-w-3xl truncate font-mono text-xs">
            {{ token || '暂无 Token' }}
          </div>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" :disabled="!token" @click="copyToken">
            <Copy class="size-4" />
            复制
          </Button>
          <Button variant="outline" size="sm" @click="rotateToken">轮换</Button>
        </div>
      </div>
    </div>

    <div v-if="token" class="rounded-lg border p-4">
      <div class="mb-3 text-sm font-medium">安装 cloudflared 连接器</div>
      <TunnelInstallPanel :token="token" />
    </div>

    <TableLoading :loading="loading" :empty="!routes.length">
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
            v-for="(record, index) in pagedRoutes"
            :key="`${record.hostname}-${record.path}-${index}`"
            :class="isRowBusy(routeKey(record)) && 'bg-muted/40 opacity-80'"
          >
            <TableCell class="px-4 font-medium">{{ record.hostname || '-' }}</TableCell>
            <TableCell class="max-w-[280px] truncate">{{ record.service || '-' }}</TableCell>
            <TableCell>{{ record.path || '/' }}</TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-8"
                    :disabled="isRowBusy(routeKey(record))"
                  >
                    <Spinner v-if="isRowBusy(routeKey(record))" class="size-4" />
                    <EllipsisVertical v-else class="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="openEditRoute(record)">编辑</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" @click="removeRoute(record)">删除</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

    <AppDialog v-model:open="dialogOpen" :title="editingRoute ? '编辑路由' : '添加路由'" description="把公网 hostname 映射到本地服务。">
      <FieldGroup>
        <Field :data-invalid="!!routeErrors.hostname">
          <FieldLabel>Hostname</FieldLabel>
          <Input v-model="form.hostname" placeholder="app.example.com" />
          <FieldError :errors="routeErrors.hostname ? [routeErrors.hostname] : []" />
        </Field>
        <Field :data-invalid="!!routeErrors.service">
          <FieldLabel>Service</FieldLabel>
          <Input v-model="form.service" placeholder="http://localhost:8080" />
          <FieldError :errors="routeErrors.service ? [routeErrors.service] : []" />
        </Field>
        <Field>
          <FieldLabel>Path（可选）</FieldLabel>
          <Input v-model="form.path" placeholder="/" />
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="dialogOpen = false">取消</Button>
        <Button :loading="saving" @click="saveRoute">添加</Button>
      </template>
    </AppDialog>
  </div>
</template>
