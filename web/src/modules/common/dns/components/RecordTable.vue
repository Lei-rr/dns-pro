<template>
  <a-table
    :columns="columns"
    :data-source="records"
    :row-key="rowKey"
    :loading="loading"
    :pagination="tablePaginationConfig"
    :row-selection="{ selectedRowKeys, onChange: selectRows }"
    :locale="{ emptyText }"
    size="middle"
    :scroll="{ x: 760 }"
    @change="handleTableChange"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'name'">
        <a-typography-text strong :ellipsis="{ tooltip: record.name }" style="max-width: 130px">{{
          record.name
        }}</a-typography-text>
      </template>
      <template v-else-if="column.key === 'type'">
        <a-space size="small">
          <a-tag :color="typeColor(record.type)">{{ record.type }}</a-tag>
          <a-tag
            v-if="
              record.type === 'MX' &&
              record.priority !== undefined &&
              record.priority !== null &&
              record.priority !== ''
            "
            color="blue"
            >{{ record.priority }}</a-tag
          >
        </a-space>
      </template>
      <template v-else-if="column.key === 'value'">
        <a-space size="small" style="max-width: 100%">
          <a-typography-text :ellipsis="{ tooltip: record.value }" style="max-width: var(--table-copy-width)">{{
            record.value
          }}</a-typography-text>
          <CopyButton :value="record.value" />
        </a-space>
      </template>
      <template v-else-if="column.key === 'line'">
        <a-tag v-if="hasProxy" :color="record.proxied ? hook.proxyOnColor : hook.proxyOffColor">{{
          record.proxied ? hook.proxyOnText : hook.proxyOffText
        }}</a-tag>
        <span v-else>{{ record.line || '默认' }}</span>
      </template>
      <template v-else-if="column.key === 'remark'">
        <a-typography-text type="secondary" :ellipsis="{ tooltip: record.remark }" style="max-width: var(--table-remark-width)">{{
          record.remark || '-'
        }}</a-typography-text>
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
import { defaultProviderHook } from '../hook'
import { dnsRecordTypeColors } from '../utils/format'
import type { DnsRecord, ProviderHook } from '@/types'

const props = defineProps<{
  records?: DnsRecord[]
  providerHook?: ProviderHook
  loading?: boolean
  pagination?: Record<string, unknown>
  emptyText?: string
  selectionResetKey?: number
  typeOptions?: Array<{ label: string; value: string }>
  actionsDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit', record: DnsRecord): void
  (e: 'delete', record: DnsRecord): void
  (e: 'selection-change', rows: DnsRecord[]): void
  (e: 'change', pagination: { current?: number; pageSize?: number }): void
}>()

const selectedRowKeys = ref<(string | number)[]>([])

const hook = computed(() => props.providerHook || defaultProviderHook)
const showTtl = computed(() => hook.value.showTtl)
const hasProxy = computed(() => hook.value.proxyTypes.length > 0)
const columns = computed(() => {
  const cols: Array<Record<string, unknown>> = [
    { title: '主机', dataIndex: 'name', key: 'name', width: 150 },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      filters: (props.typeOptions || []).map((item) => ({ text: item.label, value: item.value })),
      onFilter: (value: string, record: DnsRecord) => record.type === value,
    },
    {
      title: '记录值',
      dataIndex: 'value',
      key: 'value',
      width: 360,
      filters: uniqueFilters((props.records || []).map((record) => record.value || '')),
      onFilter: (value: string, record: DnsRecord) => record.value === value,
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
        ? [
            { text: hook.value.proxyOnText, value: 'proxied' },
            { text: hook.value.proxyOffText, value: 'dns_only' },
          ]
        : uniqueFilters((props.records || []).map((record) => record.line || '默认')),
      onFilter: (value: string, record: DnsRecord) =>
        hasProxy.value
          ? value === 'proxied'
            ? !!record.proxied
            : !record.proxied
          : (record.line || '默认') === value,
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', width: 160 },
    { title: '操作', key: 'actions', width: 110, align: 'right' }
  )

  return cols
})
const tablePaginationConfig = computed(() => props.pagination || tablePagination())

function rowKey(record: DnsRecord) {
  return String(record.id || '')
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

function typeColor(type: string | undefined) {
  return dnsRecordTypeColors[type || ''] || 'default'
}

function selectRows(keys: (string | number)[], rows: DnsRecord[]) {
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

function actionItems(_record?: DnsRecord): Array<{ key: string; label: string; danger?: boolean; inline?: boolean }> {
  return [{ key: 'delete', label: '删除', danger: true, inline: true }]
}

function selectAction(action: string, record: DnsRecord) {
  if (action === 'delete') emit('delete', record)
}
</script>
