<template>
  <section>
    <div class="page-toolbar">
      <div>
        <a-button type="link" style="padding: 0" @click="router.push(backPath)">返回隧道列表</a-button>
        <a-typography-title :level="3" style="margin: 4px 0">{{ tunnelName || tunnelId }}</a-typography-title>
        <a-space>
          <a-tag :color="statusColor(tunnelStatus)">{{ statusLabel(tunnelStatus) }}</a-tag>
          <a-typography-text type="secondary">Cloudflare Tunnel</a-typography-text>
        </a-space>
      </div>
      <div class="page-actions">
        <a-button :loading="loading" @click="refreshAll">刷新</a-button>
      </div>
    </div>

    <a-spin :spinning="loading && !tunnel">
      <a-tabs v-model:active-key="activeTab">
        <a-tab-pane key="overview" tab="概览">
          <a-row :gutter="16" style="margin-bottom: 24px">
            <a-col :xs="12" :sm="6">
              <a-card
                size="small"
                :body-style="{ height: '88px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }"
              >
                <a-typography-text type="secondary">活动副本</a-typography-text>
                <a-typography-title :level="3" style="margin: 4px 0 0">{{ replicaCount }}</a-typography-title>
              </a-card>
            </a-col>
            <a-col :xs="12" :sm="6">
              <a-card
                size="small"
                :body-style="{ height: '88px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }"
              >
                <a-typography-text type="secondary">路由</a-typography-text>
                <a-typography-title :level="3" style="margin: 4px 0 0">{{ routes.length }}</a-typography-title>
              </a-card>
            </a-col>
            <a-col :xs="12" :sm="6">
              <a-card
                size="small"
                :body-style="{ height: '88px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }"
              >
                <a-typography-text type="secondary">状态</a-typography-text>
                <div style="margin-top: 8px">
                  <a-tag :color="statusColor(tunnelStatus)">{{ statusLabel(tunnelStatus) }}</a-tag>
                </div>
              </a-card>
            </a-col>
            <a-col :xs="12" :sm="6">
              <a-card
                size="small"
                :body-style="{ height: '88px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }"
              >
                <a-typography-text type="secondary">运行时间</a-typography-text>
                <a-typography-title :level="5" style="margin: 4px 0 0">{{ uptime }}</a-typography-title>
              </a-card>
            </a-col>
          </a-row>

          <template v-if="((tunnel?.connections as unknown[]) || []).length > 0">
            <a-typography-title :level="5">副本</a-typography-title>
            <a-table
              :columns="connectionColumns"
              :data-source="tunnel?.connections"
              :row-key="connectionRowKey"
              :pagination="false"
              size="small"
              style="margin-bottom: 24px"
            />
          </template>

          <a-card size="small" style="margin-bottom: 24px">
            <template #title>安装 cloudflared 连接器</template>
            <a-typography-text v-if="!isConnected" type="secondary" style="display: block; margin-bottom: 12px">
              要激活此隧道，请在服务器上安装 cloudflared 连接器。每个连接器会创建一个副本，并与 Cloudflare 的网络建立 4
              个连接以实现高可用性。
            </a-typography-text>
            <a-alert v-else type="success" show-icon message="客户端已连接" style="margin-bottom: 12px" />
            <a-alert v-if="tokenError" type="error" show-icon :message="tokenError" style="margin-bottom: 12px" />
            <TunnelInstallPanel v-if="token" :token="token" />
            <a-empty v-else description="无法获取安装命令" />
          </a-card>

          <a-card size="small">
            <template #title>隧道详情</template>
            <a-descriptions :column="1" bordered size="small">
              <a-descriptions-item label="名称">{{ tunnelName }}</a-descriptions-item>
              <a-descriptions-item label="隧道 ID"
                ><a-space size="small"
                  ><a-typography-text code>{{ tunnelId }}</a-typography-text
                  ><CopyButton :value="tunnelId" /></a-space
              ></a-descriptions-item>
              <a-descriptions-item label="类型">cloudflared</a-descriptions-item>
              <a-descriptions-item label="创建时间">{{ formatDate(tunnel?.created_at as string) }}</a-descriptions-item>
            </a-descriptions>
          </a-card>

          <a-card size="small" style="margin-top: 24px">
            <template #title>轮换令牌</template>
            <a-typography-text type="secondary" style="display: block; margin-bottom: 12px">
              刷新隧道令牌以使当前令牌失效并生成新令牌。这将需要使用新令牌更新所有副本实例。
            </a-typography-text>
            <a-button danger :loading="rotating" @click="askRotateToken">轮换令牌</a-button>
          </a-card>
        </a-tab-pane>

        <a-tab-pane key="routes" tab="路由">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px">
            <a-typography-text type="secondary">公共主机名到本地服务的映射</a-typography-text>
            <a-button type="primary" :disabled="!isConnected" @click="openAddRoute">添加路由</a-button>
          </div>
          <a-alert
            v-if="!isConnected"
            type="warning"
            show-icon
            message="隧道未连接，请先安装客户端后再配置路由"
            style="margin-bottom: 16px"
          />
          <a-alert v-if="routesError" type="error" show-icon :message="routesError" style="margin-bottom: 16px" />
          <a-alert v-else-if="zonesError" type="warning" show-icon :message="zonesError" style="margin-bottom: 16px" />
          <a-table
            :columns="routeColumns"
            :data-source="routes"
            :row-key="routeRowKey"
            :loading="loadingConfig"
            :pagination="false"
            size="middle"
            :locale="{ emptyText: '暂无路由' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'path'">{{ record.path || '/' }}</template>
              <template v-else-if="column.key === 'actions'">
                <a-space size="small">
                  <a style="cursor: pointer" @click="openEditRoute(record)">编辑</a>
                  <a-divider type="vertical" />
                  <a
                    class="ant-typography ant-typography-danger"
                    style="cursor: pointer"
                    @click="askDeleteRoute(record)"
                    >删除</a
                  >
                </a-space>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
      </a-tabs>
    </a-spin>

    <RouteFormModal
      v-model:open="showRouteForm"
      :confirm-loading="savingRoute"
      :zones="zones"
      :initial-route="editingRoute"
      @submit="saveRoute"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { cloudflaredApi } from '../utils/api'
import { statusLabel, statusColor } from '../utils/format'
import { providerPath } from '@/routes/paths'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { errorMessage } from '@/shared/utils/errors'
import CopyButton from '@/shared/components/CopyButton.vue'
import TunnelInstallPanel from '../components/TunnelInstallPanel.vue'
import RouteFormModal from '../components/RouteFormModal.vue'

const REFRESH_INTERVAL_MS = 3000

const route = useRoute()
const router = useRouter()

const props = defineProps<{
  provider: string
  tunnelId: string
}>()

const tunnel = ref<Record<string, unknown> | null>(null)
const token = ref('')
const config = ref<Record<string, unknown> | null>(null)
const zones = ref<Record<string, unknown>[]>([])
const tokenError = ref('')
const routesError = ref('')
const zonesError = ref('')
const loading = ref(true)
const loadingConfig = ref(false)
const savingRoute = ref(false)
const rotating = ref(false)
const activeTab = ref('overview')
const showRouteForm = ref(false)
const editingRoute = ref<Record<string, unknown> | null>(null)
let pollingTimer: ReturnType<typeof setInterval> | null = null
const contextTask = useLatestTask()

const backPath = computed(() => providerPath(props.provider))
const tunnelName = computed(() => (tunnel.value?.name as string) || '')
const tunnelStatus = computed(() => (tunnel.value?.status as string) || 'inactive')
const isConnected = computed(() => tunnelStatus.value === 'healthy' || tunnelStatus.value === 'degraded')
const replicaCount = computed(
  () =>
    ((tunnel.value?.connections as Array<{ is_pending_reconnect?: boolean }>) || []).filter(
      (c) => !c.is_pending_reconnect
    ).length
)
const routes = computed(() => (config.value?.routes as Record<string, unknown>[]) || [])
const uptime = computed(() => {
  const active = tunnel.value?.conns_active_at as string
  if (!active) return '-'
  const ms = Date.now() - new Date(active).getTime()
  if (ms < 0) return '-'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 24) return `${Math.floor(hours / 24)}天 ${hours % 24}小时`
  if (hours > 0) return `${hours}小时 ${minutes}分`
  return `${minutes}分钟`
})
const connectionColumns = computed(() => [
  { title: '连接器 ID', dataIndex: 'client_id', key: 'client_id', width: 280 },
  { title: '版本', dataIndex: 'client_version', key: 'client_version', width: 120 },
  { title: '数据中心', dataIndex: 'colo_name', key: 'colo_name', width: 100 },
  { title: '来源 IP', dataIndex: 'origin_ip', key: 'origin_ip', width: 140 },
  { title: '连接时间', dataIndex: 'opened_at', key: 'opened_at', width: 180 },
])
const routeColumns = computed(() => [
  { title: '公共主机名', dataIndex: 'hostname', key: 'hostname', width: 240 },
  { title: '服务', dataIndex: 'service', key: 'service', width: 240 },
  { title: '路径', key: 'path', width: 120 },
  { title: '操作', key: 'actions', width: 130, align: 'right' },
])

onMounted(async () => {
  await reloadContext()
})

onBeforeUnmount(() => {
  contextTask.cancel()
  stopPolling()
})

watch(
  () => props.tunnelId,
  () => reloadContext()
)
watch(
  () => props.provider,
  () => reloadContext()
)

async function reloadContext() {
  const currentToken = contextTask.next()
  stopPolling()
  tunnel.value = null
  token.value = ''
  config.value = null
  zones.value = []
  tokenError.value = ''
  routesError.value = ''
  zonesError.value = ''
  showRouteForm.value = false
  editingRoute.value = null
  await loadAll(currentToken)
}

async function loadAll(currentToken = contextTask.next()) {
  loading.value = true
  try {
    await Promise.all([
      loadTunnel(currentToken),
      loadToken(currentToken),
      loadRoutes(currentToken),
      loadZones(currentToken),
    ])
    if (!contextTask.isCurrent(currentToken)) return
    startPolling()
  } finally {
    if (contextTask.isCurrent(currentToken)) loading.value = false
  }
}

async function refreshAll() {
  await loadAll()
}

async function loadTunnel(currentToken = contextTask.current()) {
  try {
    const response = await cloudflaredApi.tunnel(props.provider, props.tunnelId, { refresh: true })
    if (!contextTask.isCurrent(currentToken)) return
    tunnel.value = (response.data as Record<string, unknown>) || null
    if (isConnected.value) {
      stopPolling()
    }
  } catch (error) {
    if (!contextTask.isCurrent(currentToken)) return
    message.error(errorMessage(error))
  }
}

async function loadToken(currentToken = contextTask.current()) {
  try {
    const response = await cloudflaredApi.tunnelToken(props.provider, props.tunnelId)
    if (!contextTask.isCurrent(currentToken)) return
    token.value = ((response.data as Record<string, unknown>)?.token as string) || ''
    tokenError.value = ''
  } catch (error) {
    if (!contextTask.isCurrent(currentToken)) return
    tokenError.value = (error as Error).message || '无法获取安装命令'
  }
}

function askRotateToken() {
  modal.confirm({
    title: '轮换令牌',
    content: '轮换后当前令牌立即失效，所有已连接的副本会断开，需用新令牌重新安装/启动。确认轮换？',
    okText: '轮换',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => rotateToken(),
  })
}

async function rotateToken() {
  const currentToken = contextTask.current()
  rotating.value = true
  try {
    const response = await cloudflaredApi.rotateToken(props.provider, props.tunnelId)
    if (!contextTask.isCurrent(currentToken)) return
    token.value = ((response.data as Record<string, unknown>)?.token as string) || ''
    message.success('令牌已轮换，请用新令牌更新所有副本')
    startPolling()
  } catch (error) {
    if (!contextTask.isCurrent(currentToken)) return
    message.error(errorMessage(error))
  } finally {
    if (contextTask.isCurrent(currentToken)) rotating.value = false
  }
}

async function loadRoutes(currentToken = contextTask.current()) {
  loadingConfig.value = true
  try {
    const response = await cloudflaredApi.routes(props.provider, props.tunnelId)
    if (!contextTask.isCurrent(currentToken)) return
    config.value = (response.data as Record<string, unknown>) || null
    routesError.value = ''
  } catch (error) {
    if (!contextTask.isCurrent(currentToken)) return
    routesError.value = (error as Error).message || '无法加载路由配置'
  } finally {
    if (contextTask.isCurrent(currentToken)) loadingConfig.value = false
  }
}

async function loadZones(currentToken = contextTask.current()) {
  try {
    const response = await cloudflaredApi.zones(props.provider)
    if (!contextTask.isCurrent(currentToken)) return
    zones.value = response.data
    zonesError.value = ''
  } catch (error) {
    if (!contextTask.isCurrent(currentToken)) return
    zonesError.value = (error as Error).message || '无法加载 Cloudflare 站点列表'
  }
}

function startPolling() {
  stopPolling()
  if (isConnected.value) return
  pollingTimer = setInterval(() => loadTunnel(contextTask.current()), REFRESH_INTERVAL_MS)
}
function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

function openAddRoute() {
  editingRoute.value = null
  showRouteForm.value = true
}
function openEditRoute(route: Record<string, unknown>) {
  editingRoute.value = { ...route }
  showRouteForm.value = true
}
function connectionRowKey(record: Record<string, unknown>) {
  return String(record.id || record.client_id || '')
}
function routeRowKey(record: Record<string, unknown>) {
  return String(record.hostname || '') + String(record.path || '')
}

function notifyDnsOperation(operation: { status?: string; message?: string } | undefined, successFallback: string) {
  if (!operation) {
    message.success(successFallback)
    return
  }

  const text = operation.message || successFallback
  if (operation.status === 'failed') {
    message.warning(text)
    return
  }
  if (operation.status === 'skipped') {
    message.warning(text)
    return
  }

  message.success(text)
}

async function saveRoute(form: Record<string, unknown>) {
  const currentToken = contextTask.current()
  savingRoute.value = true
  try {
    let response = null
    if (editingRoute.value) {
      response = await cloudflaredApi.updateRoute(
        props.provider,
        props.tunnelId,
        form,
        editingRoute.value.hostname as string,
        (editingRoute.value.path as string) || ''
      )
      if (!contextTask.isCurrent(currentToken)) return
      const dnsSync = (response.side_effects as Record<string, unknown> | undefined)?.dns as
        Record<string, unknown> | undefined
      notifyDnsOperation(dnsSync?.sync as { status?: string; message?: string } | undefined, '路由已更新')
    } else {
      response = await cloudflaredApi.addRoute(props.provider, props.tunnelId, form)
      if (!contextTask.isCurrent(currentToken)) return
      const dnsSync = (response.side_effects as Record<string, unknown> | undefined)?.dns as
        Record<string, unknown> | undefined
      notifyDnsOperation(dnsSync?.sync as { status?: string; message?: string } | undefined, '路由已添加')
    }
    showRouteForm.value = false
    editingRoute.value = null
    await loadRoutes()
  } catch (error) {
    if (!contextTask.isCurrent(currentToken)) return
    message.error(errorMessage(error))
  } finally {
    if (contextTask.isCurrent(currentToken)) savingRoute.value = false
  }
}

function askDeleteRoute(route: Record<string, unknown>) {
  modal.confirm({
    title: '删除路由',
    content: `确认删除 ${route.hostname}${route.path ? ' (' + route.path + ')' : ''} 的路由？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => removeRoute(route),
  })
}

async function removeRoute(route: Record<string, unknown>) {
  const currentToken = contextTask.current()
  try {
    const zone = matchZone(route.hostname as string)
    const response = await cloudflaredApi.deleteRoute(
      props.provider,
      props.tunnelId,
      route.hostname as string,
      (route.path as string) || '',
      (zone?.id as string) || ''
    )
    if (!contextTask.isCurrent(currentToken)) return
    const dnsEffects = (response.side_effects as Record<string, unknown> | undefined)?.dns as
      Record<string, unknown> | undefined
    notifyDnsOperation(dnsEffects?.cleanup as { status?: string; message?: string } | undefined, '路由已删除')
    await loadRoutes()
  } catch (error) {
    if (!contextTask.isCurrent(currentToken)) return
    message.error(errorMessage(error))
  }
}

function matchZone(hostname: string) {
  const sorted = [...zones.value].sort((a, b) => String(b.name || '').length - String(a.name || '').length)
  return sorted.find((zone) => hostname === zone.name || hostname.endsWith('.' + zone.name)) || null
}

function formatDate(value: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}
</script>
