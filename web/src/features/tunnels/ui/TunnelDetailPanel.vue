<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Check, Copy, Plus, RefreshCw, Wrench } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { AppTooltip } from '@/shared/ui/tooltip'
import { StatusBadge } from '@/shared/ui/status-badge'
import { TablePagination } from '@/shared/ui/pagination'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { encodePath } from '@/shared/lib/path'
import { tunnelStatusLabel } from '@/features/tunnels/lib/status'
import { useTunnelDetail } from '@/features/tunnels/model/use-tunnel-detail'
import { useTunnelRoutes } from '@/features/tunnels/model/use-tunnel-routes'
import TunnelInstallPanel from '@/features/tunnels/ui/TunnelInstallPanel.vue'
import TunnelRoutesTable from '@/features/tunnels/ui/TunnelRoutesTable.vue'
import TunnelRouteFormDialog from '@/features/tunnels/ui/TunnelRouteFormDialog.vue'

const props = defineProps<{ providerId: string; tunnelId: string }>()
const router = useRouter()

const {
  tunnel,
  routes,
  token,
  loading,
  refreshing,
  pageSize,
  setPageSize,
  refresh,
  invalidate,
  repairing,
  rotating,
  repairRoutes,
  rotateToken,
  isTokenCopied,
  copyToken,
} = useTunnelDetail(props)
const {
  saving,
  dialogOpen,
  editingRoute,
  routeErrors,
  form,
  isRouteBusy,
  openCreate,
  openEditRoute,
  saveRoute,
  removeRoute,
} = useTunnelRoutes(props, invalidate)

const title = computed(() => tunnel.value?.name || props.tunnelId)
const { page, total, pagedItems: pagedRoutes, resetPage } = useLocalPagination(routes, pageSize)

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="title" :description="`状态：${tunnelStatusLabel(tunnel?.status)} · Cloudflare Tunnel`">
      <Button variant="outline" size="sm" @click="router.push('/' + encodePath(providerId))">返回隧道列表</Button>
      <LoadingButton variant="outline" size="sm" :loading="repairing" @click="repairRoutes">
        <Wrench class="size-4" />
        修复 DNS
      </LoadingButton>
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="refreshing"
        :disabled="loading && !refreshing"
        @click="refresh()"
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
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-muted-foreground text-xs font-medium">活动副本</div>
        <div class="text-2xl font-bold tracking-tight tabular-nums">{{ tunnel?.connections.length || 0 }}</div>
      </Card>
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-muted-foreground text-xs font-medium">路由</div>
        <div class="text-2xl font-bold tracking-tight tabular-nums">{{ routes.length }}</div>
      </Card>
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-muted-foreground text-xs font-medium">状态</div>
        <div class="mt-1">
          <StatusBadge>{{ tunnelStatusLabel(tunnel?.status) }}</StatusBadge>
        </div>
      </Card>
      <Card class="gap-1 p-4 shadow-xs">
        <div class="text-muted-foreground text-xs font-medium">隧道 ID</div>
        <div class="text-muted-foreground mt-1 truncate text-xs font-mono">{{ tunnel?.id || '-' }}</div>
      </Card>
    </div>

    <Card class="gap-3 bg-muted/30 p-4 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold">安装 Token</div>
          <div class="text-muted-foreground mt-1 min-w-0 max-w-3xl truncate font-mono text-xs">
            {{ token || '暂无 Token' }}
          </div>
        </div>
        <div class="flex gap-2">
          <AppTooltip :content="isTokenCopied ? '已复制！' : '复制安装 Token'">
            <Button variant="outline" size="sm" :disabled="!token" class="cursor-pointer shadow-xs" @click="copyToken">
              <Check v-if="isTokenCopied" class="size-4 text-emerald-500" />
              <Copy v-else class="size-4" />
              {{ isTokenCopied ? '已复制' : '复制' }}
            </Button>
          </AppTooltip>
          <LoadingButton variant="outline" size="sm" :loading="rotating" class="shadow-xs" @click="rotateToken"
            >轮换</LoadingButton
          >
        </div>
      </div>
    </Card>

    <Card v-if="token" class="gap-3 p-4 shadow-xs">
      <div class="text-sm font-semibold">安装 cloudflared 连接器</div>
      <TunnelInstallPanel :token="token" />
    </Card>

    <TunnelRoutesTable
      :routes="pagedRoutes"
      :loading="loading"
      :refreshing="refreshing"
      :busy="isRouteBusy"
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
