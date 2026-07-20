<template>
  <section>
    <ListToolbar back-text="返回隧道列表" :title="tunnelName || tunnelId" @back="router.push(backPath)">
      <template #subtitle>
        <a-space>
          <a-tag :color="statusColor(tunnelStatus)">{{ statusLabel(tunnelStatus) }}</a-tag>
          <a-typography-text type="secondary">Cloudflare Tunnel</a-typography-text>
        </a-space>
      </template>
      <template #actions>
        <a-button :loading="loading" @click="handleRefresh">刷新</a-button>
      </template>
    </ListToolbar>

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

          <template v-if="((tunnel?.connections || []).length) > 0">
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
                ></a-descriptions-item
              >
              <a-descriptions-item label="类型">cloudflared</a-descriptions-item>
              <a-descriptions-item label="创建时间">{{ formatDate(tunnel?.created_at) }}</a-descriptions-item>
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
              <template v-if="column.key === 'hostname'">
                <a-typography-text :ellipsis="{ tooltip: record.hostname }" style="max-width: 220px">{{
                  record.hostname || '-'
                }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'service'">
                <a-typography-text :ellipsis="{ tooltip: record.service }" style="max-width: 220px">{{
                  record.service || '-'
                }}</a-typography-text>
              </template>
              <template v-else-if="column.key === 'path'">{{ record.path || '/' }}</template>
              <template v-else-if="column.key === 'actions'">
                <a-space size="small">
                  <a-button type="link" size="small" @click="openEditRoute(record)">编辑</a-button>
                  <a-button type="link" size="small" danger @click="askDeleteRoute(record)">删除</a-button>
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
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { message } from '@/shared/plugins/antDesignVue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import CopyButton from '@/shared/components/CopyButton.vue'
import TunnelInstallPanel from '../components/TunnelInstallPanel.vue'
import RouteFormModal from '../components/RouteFormModal.vue'
import { useTunnelDetail } from '../composables/useTunnelDetail'
import { useTunnelRoutes } from '../composables/useTunnelRoutes'

const props = defineProps<{
  provider: string
  tunnelId: string
}>()

const contextTask = useLatestTask()
const detail = useTunnelDetail(props, contextTask)
const routesApi = useTunnelRoutes(props, contextTask)

const {
  router,
  tunnel,
  token,
  tokenError,
  loading,
  rotating,
  activeTab,
  backPath,
  tunnelName,
  tunnelStatus,
  isConnected,
  replicaCount,
  uptime,
  connectionColumns,
  askRotateToken,
  connectionRowKey,
  formatDate,
  loadAll,
  reloadContext,
  stopPolling,
  statusLabel,
  statusColor,
} = detail

const {
  zones,
  routes,
  routesError,
  zonesError,
  loadingConfig,
  savingRoute,
  showRouteForm,
  editingRoute,
  routeColumns,
  openAddRoute,
  openEditRoute,
  saveRoute,
  askDeleteRoute,
  routeRowKey,
} = routesApi

async function handleRefresh() {
  await loadAll({ loadRoutes: routesApi.loadRoutes, loadZones: routesApi.loadZones })
  message.success('已刷新')
}

async function loadContext() {
  routesApi.config.value = null
  routesApi.zones.value = []
  routesApi.routesError.value = ''
  routesApi.zonesError.value = ''
  routesApi.showRouteForm.value = false
  routesApi.editingRoute.value = null
  await reloadContext({ loadRoutes: routesApi.loadRoutes, loadZones: routesApi.loadZones })
}

onMounted(async () => {
  await loadContext()
})

onBeforeUnmount(() => {
  contextTask.cancel()
  stopPolling()
})

watch(() => props.tunnelId, loadContext)
watch(() => props.provider, loadContext)
</script>
