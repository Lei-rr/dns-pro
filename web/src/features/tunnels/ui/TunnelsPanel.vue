<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { EllipsisVertical, Plus, RefreshCw, Server } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableLoading } from '@/shared/ui/table'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { cloudflaredApi } from '@/features/tunnels/api/tunnel-api'
import { tunnelStatusLabel } from '@/features/tunnels/lib/status'

import type { Tunnel as CloudflaredTunnel } from '@/features/tunnels/model/types'
import { toast } from '@/shared/lib/toast'
import { confirmDelete } from '@/shared/ui/confirm'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { removeListItem, useRowBusy } from '@/shared/lib/row-busy'
import { serverFieldErrors } from '@/shared/lib/field-errors'
import { createScopeGeneration } from '@/shared/lib/scope-generation'
import { encodePath } from '@/shared/lib/path'

const props = defineProps<{ providerId: string }>()
const router = useRouter()

const creating = ref(false)
const tunnels = ref<CloudflaredTunnel[]>([])
const dialogOpen = ref(false)
const name = ref('')
const nameError = ref('')
const providerGeneration = createScopeGeneration()
const { isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()

const {
  loading,
  refreshing,
  pageSize,
  runLoad,
  onRefresh,
  onPageSizeChange: setPageSize,
  fail,
} = useListPage({
  pageSizeScope: 'cloudflared-tunnels',
  load: async (options = {}) => {
    try {
      const response = await cloudflaredApi.tunnels(props.providerId, { refresh: options.refresh })
      if (options.isLatest && !options.isLatest()) return false
      tunnels.value = response.data || []
      return true
    } catch (error) {
      if (!options.isLatest || options.isLatest()) fail(error)
      return false
    }
  },
})
const tunnelItems = computed(() => tunnels.value)
const { page, total, pagedItems: pagedTunnels, resetPage } = useLocalPagination(tunnelItems, pageSize)

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
}

function openDetail(record: CloudflaredTunnel) {
  router.push(`/${encodePath(props.providerId)}/${encodePath(String(record.id || record.name))}`)
}

function openCreate() {
  nameError.value = ''
  dialogOpen.value = true
}

async function createTunnel() {
  if (creating.value) return
  const scopeOwner = providerGeneration.capture({ providerId: props.providerId })
  const value = name.value.trim()
  nameError.value = value ? '' : '请填写隧道名称'
  if (nameError.value) return
  creating.value = true
  try {
    const response = await cloudflaredApi.createTunnel(scopeOwner.value.providerId, value)
    if (!scopeOwner.active()) return
    const tokenEffect = response.side_effects?.tunnel?.token
    if (tokenEffect?.status === 'failed') toast.warning('隧道已创建，令牌获取失败，可进入详情重试')
    else toast.success('隧道已创建')
    dialogOpen.value = false
    name.value = ''
    await runLoad()
  } catch (error) {
    if (!scopeOwner.active()) return
    nameError.value = serverFieldErrors(error).name || nameError.value
    fail(error)
  } finally {
    if (scopeOwner.active()) creating.value = false
  }
}

async function removeTunnel(record: CloudflaredTunnel) {
  const scopeOwner = providerGeneration.capture({ providerId: props.providerId })
  const tunnelId = String(record.id || '')
  const tunnelKey = String(record.id || record.name)
  if (!(await confirmDelete(String(record.name || record.id || ''))) || !scopeOwner.active()) return
  await runBusy(tunnelKey, async (owner) => {
    try {
      await cloudflaredApi.deleteTunnel(scopeOwner.value.providerId, tunnelId)
      if (!scopeOwner.active() || !owner.active()) return
      toast.success('已删除')
      removeListItem(tunnels, (item) => String(item.id || item.name) === tunnelKey)
    } catch (error) {
      if (scopeOwner.active() && owner.active()) fail(error)
    }
  })
}

function replicaCount(record: CloudflaredTunnel) {
  return Array.isArray(record.connections) ? record.connections.length : 0
}

watch(
  () => props.providerId,
  () => {
    providerGeneration.invalidate()
    resetRowOperations()
    tunnels.value = []
    dialogOpen.value = false
    creating.value = false
    void runLoad()
  }
)

onMounted(() => runLoad())
onUnmounted(() => {
  providerGeneration.invalidate()
  resetRowOperations()
})
</script>
<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="Cloudflare Tunnel" description="隧道列表，详情页可管理路由与安装令牌。">
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
        创建隧道
      </Button>
    </PageHeader>

    <TableLoading :loading="loading" :refreshing="refreshing" :empty="!tunnels.length">
      <Table>
        <TableHeader class="bg-muted/50">
          <TableRow class="!border-0">
            <TableHead class="rounded-l-lg px-4">名称</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>副本</TableHead>
            <TableHead>隧道 ID</TableHead>
            <TableHead class="rounded-r-lg w-[7.5rem] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody class="**:data-[slot=table-cell]:py-2.5">
          <TableRow v-if="!tunnels.length && !loading">
            <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
              <div class="flex flex-col items-center justify-center gap-1.5 py-4">
                <Server class="size-8 text-muted-foreground/40 stroke-1" />
                <div class="font-medium text-foreground/80 text-sm">暂无隧道</div>
                <div class="text-xs text-muted-foreground">点击右上角「创建隧道」开始配置 Cloudflare Tunnel</div>
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-for="record in pagedTunnels" :key="String(record.id || record.name)">
            <TableCell class="px-4">
              <Button
                variant="link"
                class="h-auto px-0 py-0 font-medium"
                :disabled="isRowBusy(String(record.id || record.name))"
                @click="openDetail(record)"
                >{{ record.name }}</Button
              >
            </TableCell>
            <TableCell>
              <StatusBadge>{{ tunnelStatusLabel(record.status) }}</StatusBadge>
            </TableCell>
            <TableCell>{{ replicaCount(record) }}</TableCell>
            <TableCell class="max-w-[220px] truncate text-sm">{{ record.id || '-' }}</TableCell>
            <TableCell class="text-right">
              <div class="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="isRowBusy(String(record.id || record.name))"
                  @click="openDetail(record)"
                  >管理</Button
                >
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :disabled="isRowBusy(String(record.id || record.name))"
                    >
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      :disabled="isRowBusy(String(record.id || record.name))"
                      @click="removeTunnel(record)"
                      >删除</DropdownMenuItem
                    >
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
      @update:page="page = $event"
      @update:page-size="onPageSizeChange"
    />

    <AppDialog v-model:open="dialogOpen" title="创建隧道" description="创建一个新的 Cloudflare Tunnel。">
      <FieldGroup>
        <Field :data-invalid="!!nameError">
          <FieldLabel>隧道名称</FieldLabel>
          <Input v-model="name" placeholder="my-tunnel" @keyup.enter="createTunnel" />
          <FieldError :errors="nameError ? [nameError] : []" />
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="dialogOpen = false">取消</Button>
        <LoadingButton :loading="creating" @click="createTunnel">创建</LoadingButton>
      </template>
    </AppDialog>
  </div>
</template>
