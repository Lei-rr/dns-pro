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
import type { EdgeOneAccelerationDomain, EdgeOneCertificate, EdgeOneCertificateItem } from '@/types'

const props = defineProps<{
  records?: EdgeOneAccelerationDomain[]
  loading?: boolean
  pagination?: Record<string, unknown>
  emptyText?: string
  selectionResetKey?: number
  actionsDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit', record: EdgeOneAccelerationDomain): void
  (e: 'status', record: EdgeOneAccelerationDomain): void
  (e: 'certificate', record: EdgeOneAccelerationDomain): void
  (e: 'delete', record: EdgeOneAccelerationDomain): void
  (e: 'selection-change', rows: EdgeOneAccelerationDomain[]): void
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
    onFilter: (value: string, record: EdgeOneAccelerationDomain) => record.status === value,
  },
  {
    title: 'CNAME',
    dataIndex: 'cname',
    key: 'cname',
    width: 320,
    filters: uniqueFilters((props.records || []).map((record) => record.cname || '')),
    onFilter: (value: string, record: EdgeOneAccelerationDomain) => record.cname === value,
  },
  {
    title: '源站',
    key: 'origin',
    width: 320,
    filters: uniqueFilters((props.records || []).map((record) => record.origin?.value || '')),
    onFilter: (value: string, record: EdgeOneAccelerationDomain) => record.origin?.value === value,
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
    onFilter: (value: string, record: EdgeOneAccelerationDomain) =>
      value === 'enabled'
        ? record.certificate?.mode !== 'disable'
        : record.certificate?.mode === 'disable',
  },
  { title: '操作', key: 'actions', width: 110, align: 'right' },
])
const tablePaginationConfig = computed(() => props.pagination || tablePagination())

function rowKey(record: EdgeOneAccelerationDomain) {
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

function statusColor(status: string | undefined) {
  return edgeOneStatusColors[status || ''] || (status ? 'red' : 'default')
}
function statusLabel(record: EdgeOneAccelerationDomain) {
  return edgeOneStatusLabels[record.status || ''] || record.status || '-'
}
function selectRows(keys: (string | number)[], rows: EdgeOneAccelerationDomain[]) {
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
function originTypeLabel(type: string | undefined) {
  return edgeOneOriginTypeLabels[type || ''] || type || '-'
}
function ipv6Label(status: string | undefined) {
  const normalized = String(status || '').toLowerCase()
  return edgeOneIpv6Labels[normalized] || status || '-'
}
function ipv6Enabled(status: string | undefined) {
  return ['on', 'enabled', 'enable'].includes(String(status || '').toLowerCase())
}
function certificateList(certificate?: EdgeOneCertificate): EdgeOneCertificateItem[] {
  return certificate?.items || certificate?.list || []
}
function httpsLabel(record: EdgeOneAccelerationDomain) {
  const mode = record.certificate?.mode || 'disable'
  if (mode === 'disable') return '未配置'
  const cert = certificateList(record.certificate)
  const first = cert[0]
  if (first?.status && normalizeStatus(first.status) !== 'deployed')
    return certificateStatusLabel(first.status)
  return '已部署'
}
function httpsColor(record: EdgeOneAccelerationDomain) {
  const mode = record.certificate?.mode || 'disable'
  if (mode === 'disable') return 'default'
  const cert = certificateList(record.certificate)
  const first = cert[0]
  return certificateStatusColor(first?.status || 'deployed')
}
function actionItems(record: EdgeOneAccelerationDomain): Array<{ key: string; label: string; danger?: boolean }> {
  const items: Array<{ key: string; label: string; danger?: boolean }> = [
    { key: 'status', label: record.status === 'offline' ? '启用' : '停用' },
  ]

  if (record.status === 'offline') {
    items.push({ key: 'delete', label: '删除', danger: true })
  }

  return items
}
function selectAction(action: string, record: EdgeOneAccelerationDomain) {
  if (action === 'status') emit('status', record)
  if (action === 'delete') emit('delete', record)
}
</script>
