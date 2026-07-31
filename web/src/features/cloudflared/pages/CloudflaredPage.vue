<script setup lang="ts">
import { onMounted, computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { EllipsisVertical, Plus, RefreshCw } from '@lucide/vue'
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
  TableRow,
  TableLoading,
} from '@/shared/ui/table'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { cloudflaredApi } from '@/features/cloudflared/api/cloudflared'
import { tunnelStatusLabel } from '@/features/cloudflared/lib/status'
import { providerChildPath } from '@/features/providers/lib/paths'
import type { CloudflaredTunnel } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { confirmDelete } from '@/shared/ui/confirm'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { removeListItem } from '@/shared/lib/row-busy'
import { serverFieldErrors } from '@/shared/lib/field-errors'

const props = defineProps<{ providerId: string }>()
const router = useRouter()

const creating = ref(false)
const tunnels = ref<CloudflaredTunnel[]>([])
const dialogOpen = ref(false)
const name = ref('')
const nameError = ref('')

const { loading, refreshing, pageSize, runLoad, onRefresh, onPageSizeChange: setPageSize, fail } = useListPage({
  pageSizeScope: 'cloudflared-tunnels',
  load: async (options = {}) => {
    try {
      const response = await cloudflaredApi.tunnels(props.providerId, { refresh: options.refresh })
      if (options.isLatest && !options.isLatest()) return false
      tunnels.value = response.data || []
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
  router.push(providerChildPath(props.providerId, String(record.id || record.name)))
}

function openCreate() {
  nameError.value = ''
  dialogOpen.value = true
}

async function createTunnel() {
  const value = name.value.trim()
  nameError.value = value ? '' : '请填写隧道名称'
  if (nameError.value) return
  creating.value = true
  try {
    await cloudflaredApi.createTunnel(props.providerId, value)
    toast.success('隧道已创建')
    dialogOpen.value = false
    name.value = ''
    await runLoad()
  } catch (error) {
    nameError.value = serverFieldErrors(error).name || nameError.value
    fail(error)
  } finally {
    creating.value = false
  }
}

async function removeTunnel(record: CloudflaredTunnel) {
  if (!(await confirmDelete(String(record.name || record.id || '')))) return
  try {
    await cloudflaredApi.deleteTunnel(props.providerId, String(record.id))
    toast.success('已删除')
    removeListItem(tunnels, (item) => String(item.id || item.name) === String(record.id || record.name))
  } catch (error) {
    fail(error)
  }
}

function replicaCount(record: CloudflaredTunnel) {
  return Array.isArray(record.connections) ? record.connections.length : 0
}

watch(
  () => props.providerId,
  () => runLoad(),
)

onMounted(() => runLoad())
</script>
<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="Cloudflare Tunnel" description="隧道列表，详情页可管理路由与安装令牌。">
      <Button variant="outline" size="sm" :loading="refreshing" :disabled="loading && !refreshing" @click="onRefresh()">
        <RefreshCw class="size-4" />
        刷新
      </Button>
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
              暂无隧道，点击「创建隧道」开始
            </TableCell>
          </TableRow>
          <TableRow v-for="record in pagedTunnels" :key="String(record.id || record.name)">
            <TableCell class="px-4">
              <button class="font-medium hover:underline" @click="openDetail(record)">{{ record.name }}</button>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{{ tunnelStatusLabel(record.status) }}</Badge>
            </TableCell>
            <TableCell>{{ replicaCount(record) }}</TableCell>
            <TableCell class="max-w-[220px] truncate text-sm">{{ record.id || '-' }}</TableCell>
            <TableCell class="text-right">
              <div class="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                <Button variant="ghost" size="sm" @click="openDetail(record)">管理</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8">
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" @click="removeTunnel(record)">删除</DropdownMenuItem>
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
        <Button :loading="creating" @click="createTunnel">创建</Button>
      </template>
    </AppDialog>
  </div>
</template>
