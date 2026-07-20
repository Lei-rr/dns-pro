<template>
  <section>
    <ListToolbar
      title="Cloudflare Tunnel"
      subtitle="隧道列表，详情页在未连接时会自动刷新状态"
      :show-search="false"
    >
      <template #actions>
        <a-button :loading="loading" @click="handleRefresh">刷新</a-button>
        <a-button type="primary" @click="openCreate">创建隧道</a-button>
      </template>
    </ListToolbar>

    <a-table
      :columns="columns"
      :data-source="tunnels"
      :row-key="tunnelRowKey"
      :loading="loading"
      :pagination="false"
      size="middle"
      :scroll="{ x: 880 }"
      :locale="{ emptyText: '暂无隧道，点击「创建隧道」开始' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <a-space>
            <a-avatar size="small" :style="{ background: tunnelAvatarColor() }">{{
              tunnelAvatar(record.name)
            }}</a-avatar>
            <router-link :to="detailPath(record)">{{ record.name }}</router-link>
          </a-space>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'replicas'">{{ replicaCount(record) }}</template>
        <template v-else-if="column.key === 'type'"><a-tag>cloudflared</a-tag></template>
        <template v-else-if="column.key === 'id'">
          <a-typography-text :ellipsis="{ tooltip: record.id }" code style="max-width: 180px">{{
            record.id
          }}</a-typography-text>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <router-link :to="detailPath(record)">管理</router-link>
            <a-button type="link" size="small" danger @click="askDelete(record)">删除</a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <TunnelCreateModal v-model:open="showCreate" :confirm-loading="creating" @submit="create" />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { cloudflaredApi } from '../utils/api'
import { providerAvatarColor } from '@/providers/branding'
import { statusLabel, statusColor } from '../utils/format'
import { providerChildPath } from '@/routes/paths'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { errorMessage } from '@/shared/utils/errors'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import TunnelCreateModal from '../components/TunnelCreateModal.vue'
import type { CloudflaredTunnel } from '@/types'

const props = defineProps<{
  provider: string
}>()

const router = useRouter()

const tunnels = ref<CloudflaredTunnel[]>([])
const loading = ref(true)
const creating = ref(false)
const showCreate = ref(false)
const loadTask = useLatestTask()
const contextTask = useLatestTask()

const columns = computed(() => [
  { title: '名称', dataIndex: 'name', key: 'name', width: 220 },
  { title: '状态', key: 'status', width: 110 },
  { title: '副本', key: 'replicas', width: 80 },
  { title: '类型', key: 'type', width: 110 },
  { title: '隧道 ID', dataIndex: 'id', key: 'id', width: 280, responsive: ['lg'] },
  { title: '操作', key: 'actions', width: 140, align: 'right' },
])

onMounted(async () => {
  await load()
})

watch(
  () => props.provider,
  () => {
    contextTask.cancel()
    tunnels.value = []
    showCreate.value = false
    load()
  }
)

function tunnelAvatar(name: string | undefined) {
  return (String(name || '').match(/[a-z0-9]/i)?.[0] || 'T').toUpperCase()
}
function tunnelAvatarColor() {
  return providerAvatarColor('cloudflared')
}
function detailPath(tunnel: CloudflaredTunnel) {
  return providerChildPath(props.provider, tunnel.id || '')
}
function tunnelRowKey(tunnel: CloudflaredTunnel) {
  return String(tunnel.id || '')
}

async function handleRefresh() {
  await load({ refresh: true })
  message.success('已刷新')
}
async function load(options: Record<string, unknown> = {}) {
  const requestToken = loadTask.next()
  loading.value = true
  try {
    const response = await cloudflaredApi.tunnels(props.provider, options)
    if (!loadTask.isCurrent(requestToken)) return
    tunnels.value = response.data
  } catch (error) {
    if (!loadTask.isCurrent(requestToken)) return
    message.error(errorMessage(error))
  } finally {
    if (loadTask.isCurrent(requestToken)) loading.value = false
  }
}

function openCreate() {
  showCreate.value = true
}

async function create(name: string) {
  const token = contextTask.next()
  creating.value = true
  try {
    const response = await cloudflaredApi.createTunnel(props.provider, name)
    if (!contextTask.isCurrent(token)) return
    const tunnel = response.data?.tunnel || {}
    showCreate.value = false
    message.success('隧道已创建')
    router.push(detailPath(tunnel))
  } catch (error) {
    if (!contextTask.isCurrent(token)) return
    message.error(errorMessage(error))
  } finally {
    if (contextTask.isCurrent(token)) creating.value = false
  }
}

function askDelete(tunnel: CloudflaredTunnel) {
  modal.confirm({
    title: '删除隧道',
    content: `确认删除隧道「${tunnel.name}」？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => remove(tunnel),
  })
}

async function remove(tunnel: CloudflaredTunnel) {
  const token = contextTask.next()
  try {
    await cloudflaredApi.deleteTunnel(props.provider, tunnel.id || '')
    if (!contextTask.isCurrent(token)) return
    message.success('已删除')
    await load({ refresh: true })
  } catch (error) {
    if (!contextTask.isCurrent(token)) return
    message.error(errorMessage(error))
  }
}

function replicaCount(tunnel: CloudflaredTunnel) {
  return ((tunnel.connections || []).filter(
    (c) => !c.is_pending_reconnect
  )).length
}
</script>
