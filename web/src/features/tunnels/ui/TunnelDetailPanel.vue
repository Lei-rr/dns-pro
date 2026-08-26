<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Copy, Plus, RefreshCw } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { AppTooltip } from '@/shared/ui/tooltip'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cloudflaredApi } from '@/features/tunnels/api/tunnel-api'
import { tunnelStatusLabel } from '@/features/tunnels/lib/status'

import type { Tunnel as CloudflaredTunnel, TunnelRoute as CloudflaredRoute } from '@/features/tunnels/model/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { useRowBusy, removeListItem } from '@/shared/lib/row-busy'
import TunnelInstallPanel from '@/features/tunnels/ui/TunnelInstallPanel.vue'
import TunnelRoutesTable from '@/features/tunnels/ui/TunnelRoutesTable.vue'
import TunnelRouteFormDialog from '@/features/tunnels/ui/TunnelRouteFormDialog.vue'
import { confirmDelete } from '@/shared/ui/confirm'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { serverFieldErrors } from '@/shared/lib/field-errors'
import { encodePath } from '@/shared/lib/path'
import { createScopeGeneration, type GenerationOwner } from '@/shared/lib/scope-generation'

const props = defineProps<{ providerId: string; tunnelId: string }>()
const mutationGeneration = createScopeGeneration()
const tokenGeneration = createScopeGeneration()
const rotationGeneration = createScopeGeneration()

function captureMutationOwner(): GenerationOwner {
  return mutationGeneration.capture({})
}
const { isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()
function routeKey(record: CloudflaredRoute) {
  return `${record.hostname || ''}|${record.path || ''}`
}
const router = useRouter()

const saving = ref(false)
const rotating = ref(false)
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

const {
  loading,
  refreshing,
  pageSize,
  runLoad,
  onRefresh,
  onPageSizeChange: setPageSize,
  fail,
} = useListPage({
  pageSizeScope: 'cloudflared-detail',
  load: async (options = {}) => {
    const tokenOwner = tokenGeneration.claim({ providerId: props.providerId, tunnelId: props.tunnelId })
    try {
      const [tunnelRes, routesRes, tokenRes] = await Promise.all([
        cloudflaredApi.tunnel(tokenOwner.value.providerId, tokenOwner.value.tunnelId, { refresh: options.refresh }),
        cloudflaredApi.routes(tokenOwner.value.providerId, tokenOwner.value.tunnelId, { refresh: options.refresh }),
        cloudflaredApi.tunnelToken(tokenOwner.value.providerId, tokenOwner.value.tunnelId).catch(() => null),
      ])
      if (options.isLatest && !options.isLatest()) return false
      tunnel.value = tunnelRes.data
      routes.value = routesRes.data?.routes || []
      if (tokenOwner.active()) token.value = tokenRes?.data?.token || ''
      return true
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
  if (saving.value) return
  const owner = captureMutationOwner()
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
        String(editingRoute.value.path || '')
      )
      if (!owner.active()) return
      notifyDnsSideEffect(response.data?.side_effects?.dns?.sync, '路由已更新')
    } else {
      const response = await cloudflaredApi.addRoute(props.providerId, props.tunnelId, data)
      if (!owner.active()) return
      notifyDnsSideEffect(response.data?.side_effects?.dns?.sync, '路由已添加')
    }
    dialogOpen.value = false
    await runLoad()
  } catch (error) {
    if (!owner.active()) return
    routeErrors.value = { ...routeErrors.value, ...serverFieldErrors(error) }
    toast.error(errorMessage(error))
  } finally {
    if (owner.active()) saving.value = false
  }
}

async function removeRoute(record: CloudflaredRoute) {
  const scopeOwner = captureMutationOwner()
  const providerId = props.providerId
  const tunnelId = props.tunnelId
  const hostname = String(record.hostname || '')
  const path = String(record.path || '')
  if (!(await confirmDelete(hostname)) || !scopeOwner.active()) return
  const key = routeKey(record)
  await runBusy(key, async (owner) => {
    if (!scopeOwner.active()) return
    try {
      const response = await cloudflaredApi.deleteRoute(providerId, tunnelId, hostname, path)
      if (!scopeOwner.active() || !owner.active()) return
      notifyDnsSideEffect(response.data?.side_effects?.dns?.cleanup, '已删除')
      removeListItem(routes, (item) => routeKey(item) === key)
    } catch (error) {
      if (scopeOwner.active() && owner.active()) toast.error(errorMessage(error))
    }
  })
}

async function rotateToken() {
  if (rotating.value) return
  const owner = rotationGeneration.claim({ providerId: props.providerId, tunnelId: props.tunnelId })
  const tokenOwner = tokenGeneration.claim({ providerId: owner.value.providerId, tunnelId: owner.value.tunnelId })
  rotating.value = true
  try {
    const response = await cloudflaredApi.rotateToken(owner.value.providerId, owner.value.tunnelId)
    if (!owner.active() || !tokenOwner.active()) return
    token.value = response.data?.token || ''
    toast.success('Token 已轮换')
  } catch (error) {
    if (owner.active()) toast.error(errorMessage(error))
  } finally {
    if (owner.active()) rotating.value = false
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
  () => {
    mutationGeneration.invalidate()
    tokenGeneration.invalidate()
    rotationGeneration.invalidate()
    dialogOpen.value = false
    editingRoute.value = null
    saving.value = false
    rotating.value = false
    token.value = ''
    tunnel.value = null
    routes.value = []
    resetRowOperations()
    void runLoad()
  }
)

onMounted(() => runLoad())
onUnmounted(() => {
  mutationGeneration.invalidate()
  tokenGeneration.invalidate()
  rotationGeneration.invalidate()
  resetRowOperations()
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="title" :description="`状态：${tunnelStatusLabel(tunnel?.status)} · Cloudflare Tunnel`">
      <Button variant="outline" size="sm" @click="router.push('/' + encodePath(providerId))">返回隧道列表</Button>
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
          <StatusBadge>{{ tunnelStatusLabel(tunnel?.status) }}</StatusBadge>
        </div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-muted-foreground text-xs">隧道 ID</div>
        <div class="text-muted-foreground mt-1 truncate text-sm font-mono">{{ tunnel?.id || '-' }}</div>
      </div>
    </div>

    <div class="min-w-0 space-y-3 rounded-lg bg-muted/30 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">安装 Token</div>
          <div class="text-muted-foreground mt-1 min-w-0 max-w-3xl truncate font-mono text-xs">
            {{ token || '暂无 Token' }}
          </div>
        </div>
        <div class="flex gap-2">
          <AppTooltip content="复制安装 Token">
            <Button variant="outline" size="sm" :disabled="!token" class="cursor-pointer" @click="copyToken">
              <Copy class="size-4" />
              复制
            </Button>
          </AppTooltip>
          <LoadingButton variant="outline" size="sm" :loading="rotating" @click="rotateToken">轮换</LoadingButton>
        </div>
      </div>
    </div>

    <div v-if="token" class="min-w-0 rounded-lg border p-4">
      <div class="mb-3 text-sm font-medium">安装 cloudflared 连接器</div>
      <TunnelInstallPanel :token="token" />
    </div>

    <TunnelRoutesTable
      :routes="pagedRoutes"
      :loading="loading"
      :refreshing="refreshing"
      :busy="(record) => isRowBusy(routeKey(record))"
      @edit="openEditRoute"
      @remove="removeRoute"
    />
    <TablePagination
      :page="page"
      :page-size="pageSize"
      :total="total"
      :disabled="loading"
      @update:page="page = $event"
      @update:page-size="onPageSizeChange"
    />

    <TunnelRouteFormDialog
      v-model:open="dialogOpen"
      v-model:form="form"
      :editing="!!editingRoute"
      :saving="saving"
      :errors="routeErrors"
      @save="saveRoute"
    />
  </div>
</template>
