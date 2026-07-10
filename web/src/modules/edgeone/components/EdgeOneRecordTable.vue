<template>
  <a-table
    :columns="columns"
    :data-source="records"
    :row-key="rowKey"
    :loading="loading"
    :pagination="tablePaginationConfig"
    :row-selection="{ selectedRowKeys: internalSelectedRowKeys, onChange: selectRows }"
    :locale="{ emptyText }"
    size="middle"
    :scroll="{ x: 1060 }"
    @change="handleTableChange"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'name'">
        <a-typography-text strong class="break-text">{{ record.name }}</a-typography-text>
      </template>
      <template v-else-if="column.key === 'status'">
        <a-tag :color="statusColor(record.status)">{{ statusLabel(record) }}</a-tag>
      </template>
      <template v-else-if="column.key === 'cname'">
        <div class="copy-cell">
          <span class="truncate-text" :title="record.cname">{{ record.cname || '-' }}</span>
          <CopyButton v-if="record.cname" :value="record.cname" />
        </div>
      </template>
      <template v-else-if="column.key === 'origin'">
        <a-space direction="vertical" size="small">
          <a-space size="small" wrap>
            <a-tag>{{ originTypeLabel(record.origin?.type) }}</a-tag>
            <a-typography-text
              :ellipsis="{ tooltip: record.origin?.value }"
              style="max-width: var(--table-copy-width)"
              >{{ record.origin?.value || '-' }}</a-typography-text
            >
          </a-space>
          <a-typography-text type="secondary"
            >{{ record.origin_protocol || '-' }} · {{ record.http_origin_port || '-'
            }}{{
              record.origin_protocol === 'FOLLOW' ? ' / ' + (record.https_origin_port || '-') : ''
            }}</a-typography-text
          >
        </a-space>
      </template>
      <template v-else-if="column.key === 'ipv6'">
        <a-tag :color="ipv6Enabled(record.ipv6_status) ? 'green' : 'default'">{{
          ipv6Label(record.ipv6_status)
        }}</a-tag>
      </template>
      <template v-else-if="column.key === 'https'">
        <a-space size="small" class="nowrap-cell">
          <a-tag :color="httpsColor(record)">{{ httpsLabel(record) }}</a-tag>
          <a-button
            type="link"
            size="small"
            style="padding: 0"
            :disabled="actionsDisabled"
            @click="$emit('certificate', record)"
            >配置</a-button
          >
        </a-space>
      </template>
      <template v-else-if="column.key === 'actions'">
        <TableActions
          :items="actionItems(record)"
          :disabled="actionsDisabled"
          @edit="$emit('edit', record)"
          @select="(action) => selectAction(action, record)"
        />
      </template>
    </template>
  </a-table>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { uniqueFilters } from '@/shared/utils/format'
import { tablePagination } from '@/shared/utils/pagination'
import CopyButton from '@/shared/components/CopyButton.vue'
import TableActions from '@/shared/components/TableActions.vue'
import {
  certificateStatusColor,
  certificateStatusLabel,
  edgeOneIpv6Labels,
  edgeOneOriginTypeLabels,
  edgeOneStatusColors,
  edgeOneStatusLabels,
  normalizeStatus,
} from '../utils/format'

const props = defineProps<{
  records?: Record<string, unknown>[]
  loading?: boolean
  pagination?: Record<string, unknown>
  emptyText?: string
  selectionResetKey?: number
  actionsDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit', record: Record<string, unknown>): void
  (e: 'status', record: Record<string, unknown>): void
  (e: 'certificate', record: Record<string, unknown>): void
  (e: 'delete', record: Record<string, unknown>): void
  (e: 'selection-change', rows: Record<string, unknown>[]): void
  (e: 'change', pagination: { current?: number; pageSize?: number }): void
}>()

const internalSelectedRowKeys = ref<(string | number)[]>([])

const columns = computed(() => [
  { title: '加速域名', dataIndex: 'name', key: 'name', width: 190 },
  {
    title: '状态',
    key: 'status',
    width: 80,
    filters: [
      { text: '已生效', value: 'online' },
      { text: '部署中', value: 'process' },
      { text: '已停用', value: 'offline' },
      { text: '未生效', value: 'init' },
      { text: '已封禁', value: 'forbidden' },
    ],
    onFilter: (value: string, record: Record<string, unknown>) => record.status === value,
  },
  {
    title: 'CNAME',
    dataIndex: 'cname',
    key: 'cname',
    width: 320,
    filters: uniqueFilters((props.records || []).map((record) => record.cname as string)),
    onFilter: (value: string, record: Record<string, unknown>) => record.cname === value,
  },
  {
    title: '源站',
    key: 'origin',
    width: 320,
    filters: uniqueFilters(
      (props.records || []).map((record) => (record.origin as Record<string, unknown>)?.value as string)
    ),
    onFilter: (value: string, record: Record<string, unknown>) =>
      (record.origin as Record<string, unknown>)?.value === value,
  },
  { title: 'IPv6', key: 'ipv6', width: 90 },
  {
    title: 'HTTPS',
    key: 'https',
    width: 130,
    filters: [
      { text: '已配置', value: 'enabled' },
      { text: '未配置', value: 'disabled' },
    ],
    onFilter: (value: string, record: Record<string, unknown>) =>
      value === 'enabled'
        ? (record.certificate as Record<string, unknown>)?.mode !== 'disable'
        : (record.certificate as Record<string, unknown>)?.mode === 'disable',
  },
  { title: '操作', key: 'actions', width: 110, align: 'right' },
])
const tablePaginationConfig = computed(() => props.pagination || tablePagination())

function rowKey(record: Record<string, unknown>) {
  return String(record.name || '')
}

watch(
  () => props.records,
  () => {
    clearSelection()
  }
)
watch(
  () => props.selectionResetKey,
  () => {
    clearSelection()
  }
)

function statusColor(status: string) {
  return edgeOneStatusColors[status] || (status ? 'red' : 'default')
}
function statusLabel(record: Record<string, unknown>) {
  return edgeOneStatusLabels[record.status as string] || record.status || '-'
}
function selectRows(keys: (string | number)[], rows: Record<string, unknown>[]) {
  internalSelectedRowKeys.value = keys
  emit('selection-change', rows)
}
function clearSelection() {
  internalSelectedRowKeys.value = []
  emit('selection-change', [])
}
function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  clearSelection()
  emit('change', pagination)
}
function originTypeLabel(type: string) {
  return edgeOneOriginTypeLabels[type] || type || '-'
}
function ipv6Label(status: string) {
  const normalized = String(status || '').toLowerCase()
  return edgeOneIpv6Labels[normalized] || status || '-'
}
function ipv6Enabled(status: string) {
  return ['on', 'enabled', 'enable'].includes(String(status || '').toLowerCase())
}
function httpsLabel(record: Record<string, unknown>) {
  const mode = (record.certificate as Record<string, unknown>)?.mode || 'disable'
  if (mode === 'disable') return '未配置'
  const cert =
    ((record.certificate as Record<string, unknown>)?.items as unknown[]) ||
    ((record.certificate as Record<string, unknown>)?.list as unknown[]) ||
    []
  const first = cert[0] as Record<string, unknown>
  if (first?.status && normalizeStatus(first.status as string) !== 'deployed')
    return certificateStatusLabel(first.status as string)
  return '已部署'
}
function httpsColor(record: Record<string, unknown>) {
  const mode = (record.certificate as Record<string, unknown>)?.mode || 'disable'
  if (mode === 'disable') return 'default'
  const cert =
    ((record.certificate as Record<string, unknown>)?.items as unknown[]) ||
    ((record.certificate as Record<string, unknown>)?.list as unknown[]) ||
    []
  const first = cert[0] as Record<string, unknown>
  return certificateStatusColor((first?.status as string) || 'deployed')
}
function actionItems(record: Record<string, unknown>): Array<{ key: string; label: string; danger?: boolean }> {
  const items: Array<{ key: string; label: string; danger?: boolean }> = [
    { key: 'status', label: record.status === 'offline' ? '启用' : '停用' },
  ]

  if (record.status === 'offline') {
    items.push({ key: 'delete', label: '删除', danger: true })
  }

  return items
}
function selectAction(action: string, record: Record<string, unknown>) {
  if (action === 'status') emit('status', record)
  if (action === 'delete') emit('delete', record)
}
</script>
