<template>
  <a-table
    :columns="columns"
    :data-source="records"
    :row-key="record => record.id"
    :loading="loading"
    :pagination="tablePaginationConfig"
    :row-selection="{ selectedRowKeys, onChange: selectRows }"
    :locale="{ emptyText }"
    size="middle"
    class="dns-record-table"
    :scroll="{ x: 760 }"
    @change="handleTableChange"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'name'">
        <a-typography-text strong :ellipsis="{ tooltip: record.name }" class="dns-record-name">{{ record.name }}</a-typography-text>
      </template>
      <template v-else-if="column.key === 'type'">
        <span class="dns-type-cell">
          <a-tag :color="typeColor(record.type)">{{ record.type }}</a-tag>
          <a-tag v-if="record.type === 'MX' && record.priority !== undefined && record.priority !== null && record.priority !== ''" color="blue" class="dns-priority-tag">{{ record.priority }}</a-tag>
        </span>
      </template>
      <template v-else-if="column.key === 'value'">
        <div class="copy-cell">
          <span class="truncate-text" :title="record.value">{{ record.value }}</span>
          <CopyButton :value="record.value" />
        </div>
      </template>
      <template v-else-if="column.key === 'line'">
        <a-tag v-if="hasProxy" :color="record.proxied ? hook.proxyOnColor : hook.proxyOffColor">{{ record.proxied ? hook.proxyOnText : hook.proxyOffText }}</a-tag>
        <span v-else class="nowrap-cell">{{ record.line || '默认' }}</span>
      </template>
      <template v-else-if="column.key === 'remark'">
        <a-typography-text type="secondary" :ellipsis="{ tooltip: record.remark }" class="table-remark">{{ record.remark || '-' }}</a-typography-text>
      </template>
      <template v-else-if="column.key === 'actions'">
        <TableActions :items="actionItems(record)" :disabled="actionsDisabled" @edit="$emit('edit', record)" @select="action => selectAction(action, record)" />
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
import { defaultProviderHook } from '../hook'
import { dnsRecordTypeColors } from '../utils/format'

const props = defineProps<{
  records?: Record<string, unknown>[]
  providerHook?: Record<string, unknown>
  loading?: boolean
  pagination?: Record<string, unknown>
  emptyText?: string
  selectionResetKey?: number
  typeOptions?: Array<{ label: string; value: string }>
  actionsDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit', record: Record<string, unknown>): void
  (e: 'delete', record: Record<string, unknown>): void
  (e: 'selection-change', rows: Record<string, unknown>[]): void
  (e: 'change', pagination: { current?: number; pageSize?: number }): void
}>()

const selectedRowKeys = ref<(string | number)[]>([])

const hook = computed(() => props.providerHook || defaultProviderHook)
const showTtl = computed(() => hook.value.showTtl as boolean)
const hasProxy = computed(() => (hook.value.proxyTypes as string[]).length > 0)
const columns = computed(() => {
  const cols: Array<Record<string, unknown>> = [
    { title: '主机', dataIndex: 'name', key: 'name', width: 150 },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      filters: (props.typeOptions || []).map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value: string, record: Record<string, unknown>) => record.type === value,
    },
    {
      title: '记录值',
      dataIndex: 'value',
      key: 'value',
      width: 360,
      filters: uniqueFilters((props.records || []).map((record) => record.value as string)),
      onFilter: (value: string, record: Record<string, unknown>) => record.value === value,
    },
  ]

  if (showTtl.value) {
    cols.push({ title: 'TTL', dataIndex: 'ttl', key: 'ttl', width: 80 })
  }

  cols.push(
    {
      title: hook.value.lineLabel,
      key: 'line',
      width: 100,
      filters: hasProxy.value
        ? [{ text: hook.value.proxyOnText, value: 'proxied' }, { text: hook.value.proxyOffText, value: 'dns_only' }]
        : uniqueFilters((props.records || []).map((record) => record.line as string || '默认')),
      onFilter: (value: string, record: Record<string, unknown>) => hasProxy.value
        ? (value === 'proxied' ? !!record.proxied : !record.proxied)
        : (record.line as string || '默认') === value,
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 160 },
    { title: '操作', key: 'actions', width: 110, align: 'right' },
  )

  return cols
})
const tablePaginationConfig = computed(() => props.pagination || tablePagination())

watch(() => props.records, () => {
  clearSelection()
})

watch(() => props.selectionResetKey, () => {
  clearSelection()
})

function typeColor(type: string) {
  return dnsRecordTypeColors[type] || 'default'
}

function selectRows(keys: (string | number)[], rows: Record<string, unknown>[]) {
  selectedRowKeys.value = keys
  emit('selection-change', rows)
}

function clearSelection() {
  selectedRowKeys.value = []
  emit('selection-change', [])
}

function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  clearSelection()
  emit('change', pagination)
}

function actionItems(_record?: Record<string, unknown>): Array<{ key: string; label: string; danger?: boolean }> {
  return [{ key: 'delete', label: '删除', danger: true }]
}

function selectAction(action: string, record: Record<string, unknown>) {
  if (action === 'delete') emit('delete', record)
}
</script>
