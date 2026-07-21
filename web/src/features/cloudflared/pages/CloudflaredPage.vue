<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
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
  TableRow, TableLoading } from '@/shared/ui/table'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { cloudflaredApi, tunnelStatusLabel } from '@/features/cloudflared/api/cloudflared'
import { providerChildPath } from '@/features/providers/lib/paths'
import type { CloudflaredTunnel } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { handleRefresh, withMinLoading } from '@/shared/lib/loading'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'

const props = defineProps<{ providerId: string }>()
const router = useRouter()

const loading = ref(false)
const refreshing = ref(false)
const creating = ref(false)
const tunnels = ref<CloudflaredTunnel[]>([])
const dialogOpen = ref(false)
const name = ref('')

async function load(options: { refresh?: boolean } = {}) {
  await withMinLoading(loading, async () => {
    try {
    const response = await cloudflaredApi.tunnels(props.providerId, { refresh: options.refresh })
    tunnels.value = response.data || []
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

function openDetail(record: CloudflaredTunnel) {
  router.push(providerChildPath(props.providerId, String(record.id || record.name)))
}

async function createTunnel() {
  const value = name.value.trim()
  if (!value) {
    toast.warning('请填写隧道名称')
    return
  }
  creating.value = true
  try {
    await cloudflaredApi.createTunnel(props.providerId, value)
    toast.success('隧道已创建')
    dialogOpen.value = false
    name.value = ''
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    creating.value = false
  }
}

async function removeTunnel(record: CloudflaredTunnel) {
  if (!(await confirmDelete(String(record.name || record.id || '')))) return
  try {
    await cloudflaredApi.deleteTunnel(props.providerId, String(record.id))
    toast.success('已删除')
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

function replicaCount(record: CloudflaredTunnel) {
  return Array.isArray(record.connections) ? record.connections.length : 0
}

watch(
  () => props.providerId,
  () => load(),
)

onMounted(() => load())
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader title="Cloudflare Tunnel" description="隧道列表，详情页可管理路由与安装令牌。">
      <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
        <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
        刷新
      </Button>
      <Button size="sm" @click="dialogOpen = true">
        <Plus class="size-4" />
        创建隧道
      </Button>
    </PageHeader>

    <TableLoading :loading="loading" :empty="!tunnels.length">
      <Table>
        <TableHeader class="bg-muted/50">
          <TableRow class="!border-0">
            <TableHead class="rounded-l-lg px-4">名称</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>副本</TableHead>
            <TableHead>隧道 ID</TableHead>
            <TableHead class="rounded-r-lg w-12" />
          </TableRow>
        </TableHeader>
        <TableBody class="**:data-[slot=table-cell]:py-2.5">
          <TableRow v-if="!tunnels.length && !loading">
            <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
              暂无隧道，点击「创建隧道」开始
            </TableCell>
          </TableRow>
          <TableRow v-for="record in tunnels" :key="String(record.id || record.name)">
            <TableCell class="px-4">
              <button class="font-medium hover:underline" @click="openDetail(record)">{{ record.name }}</button>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{{ tunnelStatusLabel(record.status) }}</Badge>
            </TableCell>
            <TableCell>{{ replicaCount(record) }}</TableCell>
            <TableCell class="max-w-[220px] truncate text-sm">{{ record.id || '-' }}</TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="icon" class="size-8">
                    <EllipsisVertical class="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="openDetail(record)">管理</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" @click="removeTunnel(record)">删除</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableLoading>

    <AppDialog v-model:open="dialogOpen" title="创建隧道" description="创建一个新的 Cloudflare Tunnel。">
      <FieldGroup>
        <Field>
          <FieldLabel>隧道名称</FieldLabel>
          <Input v-model="name" placeholder="my-tunnel" @keyup.enter="createTunnel" />
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="dialogOpen = false">取消</Button>
        <Button :loading="creating" @click="createTunnel">创建</Button>
      </template>
    </AppDialog>
  </div>
</template>
