<template>
  <section>
    <ListToolbar
      title="EdgeOne"
      subtitle="选择站点进入安全加速域名管理。"
      v-model:keyword="keyword"
      search-placeholder="搜索站点"
    >
      <template #actions>
        <a-button :loading="loading" @click="handleRefresh">刷新</a-button>
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
      :locale="{ emptyText: '暂无 EdgeOne 站点' }"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <a-space style="max-width: 100%">
            <a-avatar size="small" :style="{ background: zoneAvatarColor() }">{{ zoneAvatar(record.name) }}</a-avatar>
            <router-link class="table-link-ellipsis" :to="zoneRoute(record)" :title="record.name">{{
              record.name
            }}</router-link>
          </a-space>
        </template>
        <template v-else-if="column.key === 'provider'">
          <a-tag>EdgeOne</a-tag>
        </template>
        <template v-else-if="column.key === 'id'">
          <a-typography-text :ellipsis="{ tooltip: record.id }" style="max-width: 160px">{{
            record.id
          }}</a-typography-text>
        </template>
        <template v-else-if="column.key === 'area'">{{ areaLabel(record.area) }}</template>
        <template v-else-if="column.key === 'type'">{{ typeLabel(record.type) }}</template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.active_status || record.status)">{{
            activeStatusLabel(record.active_status || record.status)
          }}</a-tag>
        </template>
        <template v-else-if="column.key === 'actions'">
          <router-link :to="zoneRoute(record)">管理</router-link>
        </template>
      </template>
    </a-table>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { edgeOneApi } from '../utils/api'
import { providerAvatarColor } from '@/providers/branding'
import { providerChildPath } from '@/routes/paths'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import { message } from '@/shared/plugins/antDesignVue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { errorMessage } from '@/shared/utils/errors'
import { mergePaginationMeta, nextPaginationState, paginationState, tablePagination } from '@/shared/utils/pagination'
import type { EdgeOneZone } from '@/types'

const props = defineProps<{
  provider: string
}>()

const zones = ref<EdgeOneZone[]>([])
const zoneMeta = ref(paginationState())
const keyword = ref('')
const loading = ref(true)
const loadTask = useLatestTask()

const filteredZones = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return zones.value
  return zones.value.filter(
    (zone) => (zone.name || '').toLowerCase().includes(k) || (zone.id || '').toLowerCase().includes(k)
  )
})
const columns = computed(() => [
  { title: '站点', dataIndex: 'name', key: 'name', width: 320 },
  { title: '服务商', key: 'provider', width: 140 },
  { title: '站点 ID', dataIndex: 'id', key: 'id', width: 180, responsive: ['md'] },
  { title: '服务区域', key: 'area', width: 100, responsive: ['sm'] },
  { title: '接入方式', key: 'type', width: 120 },
  { title: '状态', key: 'status', width: 120 },
  { title: '操作', key: 'actions', width: 100, align: 'right' },
])
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
    zoneMeta.value = paginationState()
    keyword.value = ''
    load()
  }
)

function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  const next = nextPaginationState(zoneMeta.value, pagination)
  if (!next) return
  zoneMeta.value = next
  load()
}
async function handleRefresh() {
  await load({ refresh: true })
  message.success('已刷新')
}
async function load(options: Record<string, unknown> = {}) {
  const requestToken = loadTask.next()
  loading.value = true
  try {
    const response = await edgeOneApi.zones(props.provider, {
      page: zoneMeta.value.page,
      per_page: zoneMeta.value.per_page,
      ...options,
    })
    if (!loadTask.isCurrent(requestToken)) return
    zones.value = response.data
    zoneMeta.value = mergePaginationMeta(zoneMeta.value, response.meta || {})
      } catch (error) {
    if (!loadTask.isCurrent(requestToken)) return
    message.error(errorMessage(error))
  } finally {
    if (loadTask.isCurrent(requestToken)) loading.value = false
  }
}
function zoneAvatar(zone: string | undefined) {
  return (String(zone || '').match(/[a-z0-9]/i)?.[0] || 'E').toUpperCase()
}
function zoneRowKey(zone: EdgeOneZone) {
  return String(zone.id || '')
}
function zoneAvatarColor() {
  return providerAvatarColor('edgeone')
}
const areaLabels: Record<string, string> = {
  global: '全球',
  mainland: '中国大陆',
  overseas: '海外',
}

const typeLabels: Record<string, string> = {
  full: 'NS 接入',
  partial: 'CNAME 接入',
  noDomainAccess: '无域名接入',
  dnsPodAccess: 'DNSPod 托管',
  pages: 'Pages',
  ai: '边缘推理',
}

const activeStatusLabels: Record<string, string> = {
  active: '已启用',
  inactive: '未生效',
  paused: '已停用',
}

function areaLabel(value: string | undefined) {
  return areaLabels[value || ''] || value || '-'
}
function typeLabel(value: string | undefined) {
  return typeLabels[value || ''] || value || '-'
}
function activeStatusLabel(value: string | undefined) {
  return activeStatusLabels[value || ''] || value || '-'
}
function zonePath(zone: EdgeOneZone) {
  return providerChildPath(props.provider, zone.id || '')
}
function zoneRoute(zone: EdgeOneZone) {
  return zonePath(zone)
}
function statusColor(status: string | undefined) {
  const s = status || ''
  if (['active', 'online', 'enable', 'normal'].includes(s)) return 'green'
  if (['process', 'pending', 'initializing', 'init', 'plan_migrate'].includes(s)) return 'gold'
  if (['paused', 'offline', 'inactive'].includes(s)) return 'default'
  if (['deactivated', 'isolated', 'destroyed', 'disable'].includes(s)) return 'red'
  return s ? 'red' : 'default'
}
</script>
