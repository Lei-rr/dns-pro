<template>
  <section>
    <ListToolbar
      :title="providerName"
      subtitle="选择域名进入解析管理。"
      v-model:keyword="keyword"
      search-placeholder="搜索域名"
      @search="applyKeyword"
    >
      <template #actions>
        <a-button :loading="loading" :disabled="deleting" @click="load({ refresh: true })">刷新</a-button>
        <a-button v-if="capabilities.createZone" type="primary" :disabled="loading || deleting" @click="openAddZone"
          >添加域名</a-button
        >
      </template>
    </ListToolbar>
    <a-table
      :columns="columns"
      :data-source="filteredZones"
      :row-key="zoneRowKey"
      :loading="loading"
      :pagination="pagination"
      size="middle"
      :scroll="{ x: 820 }"
      :locale="{ emptyText: '暂无域名' }"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'"
          ><a-space
            ><a-avatar size="small" :style="{ background: avatarColor() }">{{ zoneAvatar(record.name) }}</a-avatar
            ><router-link :to="routeBase() + '/' + encodeURIComponent(zoneRouteId(record))">{{
              record.name
            }}</router-link></a-space
          ></template
        >
        <template v-else-if="column.key === 'provider'"
          ><a-tag>{{ providerName }}</a-tag></template
        >
        <template v-else-if="statusColumns.some((item) => item.key === column.key)"
          ><a-tag :color="statusColor(record, statusDefinition(column.key))">{{
            statusText(record, statusDefinition(column.key))
          }}</a-tag></template
        >
        <template v-else-if="column.key === 'actions'"
          ><a-space size="small"
            ><router-link :to="routeBase() + '/' + encodeURIComponent(zoneRouteId(record))">管理</router-link
            ><a-dropdown v-if="capabilities.deleteZone"
              ><a-button type="link" size="small" style="padding: 0">更多</a-button
              ><template #overlay
                ><a-menu><a-menu-item danger @click="askRemove(record)">删除</a-menu-item></a-menu></template
              ></a-dropdown
            ></a-space
          ></template
        >
      </template>
    </a-table>
    <a-modal
      v-model:open="showAddZone"
      title="添加域名"
      :confirm-loading="adding"
      ok-text="添加"
      cancel-text="取消"
      @ok="createZone"
    >
      <a-alert
        type="info"
        show-icon
        style="margin-bottom: 16px"
        message="添加域名后，还需要到域名注册商处修改 NS。NS 生效前解析可能不会生效。"
      />
      <a-form layout="vertical"
        ><a-form-item label="域名" required
          ><a-input v-model:value="addZoneName" placeholder="example.com" @pressEnter="createZone" /></a-form-item
      ></a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { dnsApi } from '../api'
import { loadProviders } from '@/stores/providers'
import { providerPath } from '@/routes/paths'
import { resolveProviderAvatarColor, resolveProviderHook } from '@/providers/registry'
import { message, modal } from '@/shared/plugins/antDesignVue'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { errorMessage } from '@/shared/utils/errors'
import { mergePaginationMeta, nextPaginationState, paginationState, tablePagination } from '@/shared/utils/pagination'
import { defaultProviderHook } from '../hook'
import type { Provider } from '@/types'

const props = defineProps<{
  provider: string
  providerMeta?: Provider | null
}>()

const zones = ref<Record<string, unknown>[]>([])
const zoneMeta = ref(paginationState())
const currentProviderMeta = ref<Provider | null>(props.providerMeta || null)
const providerHook = ref<Record<string, unknown>>(defaultProviderHook)
const keyword = ref('')
const appliedKeyword = ref('')
const loading = ref(true)
const adding = ref(false)
const deleting = ref(false)
const showAddZone = ref(false)
const addZoneName = ref('')
const loadTask = useLatestTask()

const providerName = computed(() => currentProviderMeta.value?.name || props.provider)
const capabilities = computed(
  () => (providerHook.value.capabilities as Record<string, boolean>) || defaultProviderHook.capabilities
)
const filteredZones = computed(() => zones.value)
const statusColumns = computed(() => {
  return (
    (providerHook.value.zoneStatusColumns as Array<{ title: string; key: string; width?: number }>) ||
    defaultProviderHook.zoneStatusColumns
  ).map((column) => ({
    title: column.title,
    key: column.key,
    width: column.width || 120,
    responsive: ['sm'],
  }))
})
const statusDefinitions = computed(() => {
  return (
    (providerHook.value.zoneStatusColumns as Array<{
      title: string
      key: string
      width?: number
      getStatus?: (r: Record<string, unknown>) => unknown
    }>) || defaultProviderHook.zoneStatusColumns
  )
})
const columns = computed(() => {
  return [
    { title: '域名', dataIndex: 'name', key: 'name', width: 320 },
    { title: '服务商', key: 'provider', width: 140 },
    ...statusColumns.value,
    { title: '操作', key: 'actions', width: 120, align: 'right' },
  ]
})
const pagination = computed(() =>
  tablePagination({
    current: zoneMeta.value.page || 1,
    pageSize: zoneMeta.value.per_page || 20,
    total: zoneMeta.value.total || 0,
  })
)

onMounted(async () => {
  await load()
})

watch(
  () => props.provider,
  () => {
    currentProviderMeta.value = props.providerMeta || null
    zoneMeta.value = paginationState()
    keyword.value = ''
    appliedKeyword.value = ''
    showAddZone.value = false
    addZoneName.value = ''
    load()
  }
)

watch(
  () => props.providerMeta,
  (value) => {
    currentProviderMeta.value = value || null
  }
)

watch(keyword, (value) => {
  if (String(value || '').trim() === '' && appliedKeyword.value !== '') {
    applyKeyword()
  }
})

function routeBase(): string {
  return providerPath(props.provider)
}
function zoneRowKey(zone: Record<string, unknown>): string {
  return String(zone.provider || '') + String(zone.name || '')
}
function zoneAvatar(zone: string): string {
  return (String(zone || '').match(/[a-z0-9]/i)?.[0] || '#').toUpperCase()
}
function avatarColor(): string {
  return resolveProviderAvatarColor(currentProviderMeta.value as Provider)
}
function statusDefinition(key: string) {
  return statusDefinitions.value.find((item) => item.key === key) || null
}
function zoneStatus(
  record: Record<string, unknown>,
  column: { getStatus?: (r: Record<string, unknown>) => unknown } | null
) {
  return (
    column?.getStatus || ((item: Record<string, unknown>) => item.status || item.access_status || item.dns_status)
  )(record)
}
function statusColor(
  record: Record<string, unknown>,
  column: { getStatus?: (r: Record<string, unknown>) => unknown } | null
): string {
  return (providerHook.value.zoneStatusColor as (s: unknown) => string)(zoneStatus(record, column))
}
function statusText(
  record: Record<string, unknown>,
  column: { getStatus?: (r: Record<string, unknown>) => unknown } | null
): string {
  return (providerHook.value.zoneStatusLabel as (s: unknown) => string)(zoneStatus(record, column))
}
function applyKeyword() {
  const nextKeyword = keyword.value.trim()
  if (nextKeyword === appliedKeyword.value && zoneMeta.value.page === 1) return
  appliedKeyword.value = nextKeyword
  zoneMeta.value.page = 1
  load()
}
function openAddZone() {
  addZoneName.value = ''
  showAddZone.value = true
}
function zoneRouteId(zone: Record<string, unknown>): string {
  return zone.name as string
}
function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  const next = nextPaginationState(zoneMeta.value, pagination)
  if (!next) return
  zoneMeta.value = next
  load()
}
async function createZone() {
  const zone = addZoneName.value.trim().toLowerCase()
  if (!zone) {
    message.error('请输入域名')
    return
  }
  adding.value = true
  try {
    const response = (await dnsApi.createZone(props.provider, { domain: zone })) as { data: Record<string, unknown> }
    showAddZone.value = false
    await load({ refresh: true })
    showCreateResult(response.data)
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    adding.value = false
  }
}
function showCreateResult(result: Record<string, unknown>) {
  const nameServers = (result.name_servers as string[]) || []
  const summary = (result.message as string) || `域名 ${result.name || addZoneName.value.trim().toLowerCase()} 已添加`
  modal.info({
    title: '域名已添加',
    content: nameServers.length
      ? `${summary}\n\n请将域名 NS 修改为：\n${nameServers.join('\n')}`
      : `${summary}\n\n当前接口未返回 NS，请到 ${(result.provider_name as string) || providerName.value} 控制台查看应修改的 NS。`,
    okText: '知道了',
  })
}
function askRemove(zone: Record<string, unknown>) {
  modal.confirm({
    title: '删除域名托管',
    content: `确认从 ${providerName.value} 删除 ${zone.name}？这会删除服务商中的域名托管和解析记录，不会删除注册商里的域名。若 NS 仍指向该服务商，解析可能中断。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => remove(zone),
  })
}
async function remove(zone: Record<string, unknown>) {
  deleting.value = true
  try {
    await dnsApi.deleteZone(props.provider, zoneRouteId(zone))
    message.success('域名已删除')
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    deleting.value = false
  }
}
async function load(options: Record<string, unknown> = {}) {
  const requestToken = loadTask.next()
  loading.value = true
  try {
    if (!currentProviderMeta.value) {
      const providers = await loadProviders()
      if (!loadTask.isCurrent(requestToken)) return
      currentProviderMeta.value = providers.find((provider) => provider.id === props.provider) || null
    }
    if (!loadTask.isCurrent(requestToken)) return
    const response = await dnsApi.zones(props.provider, {
      page: zoneMeta.value.page,
      per_page: zoneMeta.value.per_page,
      keyword: appliedKeyword.value,
      ...options,
    })
    if (!loadTask.isCurrent(requestToken)) return
    providerHook.value = resolveProviderHook(currentProviderMeta.value?.type || props.provider)
    zones.value = response.data
    zoneMeta.value = mergePaginationMeta(zoneMeta.value, response.meta || {})
    if (options.refresh) message.success('已刷新')
  } catch (error) {
    if (!loadTask.isCurrent(requestToken)) return
    message.error(errorMessage(error))
  } finally {
    if (loadTask.isCurrent(requestToken)) loading.value = false
  }
}
</script>
