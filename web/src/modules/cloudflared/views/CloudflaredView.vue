<template>
  <section>
    <div class="page-toolbar">
      <div>
        <a-typography-title :level="3" style="margin-bottom: 4px">Cloudflare Tunnel</a-typography-title>
        <a-typography-text type="secondary">隧道列表，详情页在未连接时会自动刷新状态</a-typography-text>
      </div>
      <div class="page-actions">
        <a-button :loading="loading" @click="load({ refresh: true })">刷新</a-button>
        <a-button type="primary" @click="openCreate">创建隧道</a-button>
      </div>
    </div>

    <a-table
      :columns="columns"
      :data-source="tunnels"
      :row-key="record => record.id"
      :loading="loading"
      :pagination="false"
      size="middle"
      :scroll="{ x: 880 }"
      :locale="{ emptyText: '暂无隧道，点击「创建隧道」开始' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <a-space>
            <a-avatar size="small" :style="{ background: tunnelAvatarColor() }">{{ tunnelAvatar(record.name) }}</a-avatar>
            <router-link :to="detailPath(record)">{{ record.name }}</router-link>
          </a-space>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'replicas'">{{ replicaCount(record) }}</template>
        <template v-else-if="column.key === 'type'"><a-tag>cloudflared</a-tag></template>
        <template v-else-if="column.key === 'id'">
          <a-typography-text :ellipsis="{ tooltip: record.id }" code style="max-width: 260px">{{ record.id }}</a-typography-text>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space size="small">
            <router-link :to="detailPath(record)">管理</router-link>
            <a-divider type="vertical" />
            <a class="ant-typography ant-typography-danger" style="cursor: pointer" @click="askDelete(record)">删除</a>
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
import { errorMessage } from '@/shared/utils/errors'
import TunnelCreateModal from '../components/TunnelCreateModal.vue'

const props = defineProps<{
  provider: string
}>()

const router = useRouter()

const tunnels = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const creating = ref(false)
const showCreate = ref(false)
let loadRequestToken = 0
let contextToken = 0

const columns = computed(() => [
  { title: '名称', dataIndex: 'name', key: 'name', width: 220 },
  { title: '状态', key: 'status', width: 110 },
  { title: '副本', key: 'replicas', width: 80 },
  { title: '类型', key: 'type', width: 110 },
  { title: '隧道 ID', dataIndex: 'id', key: 'id', width: 280, responsive: ['lg'] },
  { title: '操作', key: 'actions', width: 110, align: 'right' },
])

onMounted(async () => {
  await load()
})

watch(() => props.provider, () => {
  contextToken += 1
  tunnels.value = []
  showCreate.value = false
  load()
})

function tunnelAvatar(name: string) {
  return (String(name || '').match(/[a-z0-9]/i)?.[0] || 'T').toUpperCase()
}
function tunnelAvatarColor() {
  return providerAvatarColor('cloudflared')
}
function detailPath(tunnel: Record<string, unknown>) {
  return providerChildPath(props.provider, tunnel.id as string)
}

async function load(options: Record<string, unknown> = {}) {
  const requestToken = loadRequestToken + 1
  loadRequestToken = requestToken
  loading.value = true
  try {
    const response = await cloudflaredApi.tunnels(props.provider, options)
    if (requestToken !== loadRequestToken) return
    tunnels.value = response.data
    if (options.refresh) message.success('已刷新')
  } catch (error) {
    if (requestToken !== loadRequestToken) return
    message.error(errorMessage(error))
  } finally {
    if (requestToken === loadRequestToken) loading.value = false
  }
}

function openCreate() {
  showCreate.value = true
}

async function create(name: string) {
  const token = contextToken
  creating.value = true
  try {
    const response = await cloudflaredApi.createTunnel(props.provider, name)
    if (token !== contextToken) return
    const tunnel = ((response.data as Record<string, unknown>)?.tunnel as Record<string, unknown>) || {}
    showCreate.value = false
    message.success('隧道已创建')
    router.push(detailPath(tunnel))
  } catch (error) {
    if (token !== contextToken) return
    message.error(errorMessage(error))
  } finally {
    if (token === contextToken) creating.value = false
  }
}

function askDelete(tunnel: Record<string, unknown>) {
  modal.confirm({
    title: '删除隧道',
    content: `确认删除隧道「${tunnel.name}」？`,
    okText: '删除', okType: 'danger', cancelText: '取消',
    onOk: () => remove(tunnel),
  })
}

async function remove(tunnel: Record<string, unknown>) {
  const token = contextToken
  try {
    await cloudflaredApi.deleteTunnel(props.provider, tunnel.id as string)
    if (token !== contextToken) return
    message.success('已删除')
    await load({ refresh: true })
  } catch (error) {
    if (token !== contextToken) return
    message.error(errorMessage(error))
  }
}

function replicaCount(tunnel: Record<string, unknown>) {
  return ((tunnel.connections as Array<{ is_pending_reconnect?: boolean }>) || []).filter((c) => !c.is_pending_reconnect).length
}
</script>
