<template>
  <section>
    <ListToolbar
      back-text="返回域名"
      :title="displayDomain"
      subtitle="解析记录"
      v-model:keyword="keyword"
      search-placeholder="搜索记录"
      @back="router.push(routeBase())"
      @search="applyKeyword"
    >
      <template #actions>
        <a-button v-if="capabilities.importRecords" :disabled="saving || deleting" @click="importRecords"
          >导入</a-button
        >
        <a-button v-if="capabilities.exportRecords" :disabled="!records.length" @click="exportRecords">导出</a-button>
        <a-button :loading="loading" :disabled="saving || deleting" @click="handleRefresh">刷新</a-button>
        <a-button type="primary" :disabled="saving || deleting" @click="create">添加记录</a-button>
      </template>
    </ListToolbar>
    <a-alert
      v-if="saving && deletingText"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
      :message="deletingText"
    />
    <BatchToolbar
      :count="selectedRecords.length"
      :deleting="deleting"
      delete-text="批量删除"
      @delete="askBatchRemove"
      @clear="clearSelection"
    />
    <RecordTable
      :records="filteredRecords"
      :provider-hook="providerHook"
      :loading="loading"
      :pagination="pagination"
      :selection-reset-key="selectionResetKey"
      :type-options="typeOptions"
      :actions-disabled="saving || deleting"
      empty-text="暂无匹配的解析记录"
      @edit="edit"
      @delete="askRemove"
      @change="handleTableChange"
      @selection-change="selectedRecords = $event"
    />
    <a-modal v-model:open="showForm" :title="editing ? '编辑解析记录' : '添加解析记录'" :footer="null" destroy-on-close>
      <RecordForm
        :model-value="editing"
        :saving="saving"
        :provider-hook="providerHook"
        :lines="lines"
        @save="save"
        @cancel="showForm = false"
        @delete="
          (record) => {
            showForm = false
            askRemove(record)
          }
        "
      />
    </a-modal>
    <a-modal
      v-model:open="showImportConfirm"
      title="预检导入解析记录"
      :confirm-loading="saving"
      ok-text="导入"
      cancel-text="取消"
      @ok="confirmImport"
    >
      <a-form layout="vertical">
        <a-form-item label="导入模式">
          <a-radio-group v-model:value="importMode">
            <a-radio value="create">仅新增</a-radio>
            <a-radio value="overwrite">新增或覆盖</a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
      <a-alert
        type="info"
        show-icon
        :message="
          importMode === 'overwrite'
            ? '按 主机记录 + 类型 + 线路 匹配；已存在则更新，不存在则新增。'
            : '逐条新增；已存在或格式不支持的记录会提示失败。'
        "
        style="margin-bottom: 16px"
      />
      <div style="white-space: pre-wrap">{{ importPreviewText }}</div>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import { dnsApi } from '../api'
import { loadProviders } from '@/stores/providers'
import { message, modal } from '@/shared/plugins/antDesignVue'
import { providerPath } from '@/routes/paths'
import { resolveProviderHook } from '@/providers/registry'
import ListToolbar from '@/shared/components/ListToolbar.vue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { chooseJsonFile, downloadJson } from '@/shared/utils/files'
import { errorMessage } from '@/shared/utils/errors'
import { mergePaginationMeta, nextPaginationState, paginationState, tablePagination } from '@/shared/utils/pagination'
import BatchToolbar from '@/shared/components/BatchToolbar.vue'
import RecordForm from '../components/RecordForm.vue'
import RecordTable from '../components/RecordTable.vue'
import { defaultProviderHook } from '../hook'
import { showBatchFailures } from '@/shared/utils/batch'
import type { DnsRecord, Provider, ProviderHook } from '@/types'

const props = defineProps<{
  provider: string
  domain: string
  providerMeta?: Provider | null
}>()

const router = useRouter()

const records = ref<DnsRecord[]>([])
const recordMeta = ref(paginationState())
const selectedRecords = ref<DnsRecord[]>([])
const selectionResetKey = ref(0)
const lines = ref<Array<{ label: string; value: string }>>([])
const currentProviderMeta = ref<Provider | null>(props.providerMeta || null)
const currentDomainName = ref('')
const providerHook = ref<ProviderHook>(defaultProviderHook)
const editing = ref<DnsRecord | null>(null)
const showForm = ref(false)
const keyword = ref('')
const appliedKeyword = ref('')
const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)
const deletingText = ref('')
const importMode = ref('create')
const showImportConfirm = ref(false)
const pendingImportRecords = ref<DnsRecord[]>([])
const loadTask = useLatestTask()

const decodedDomain = computed(() => decodeURIComponent(props.domain))
const providerType = computed(
  () => currentProviderMeta.value?.type || records.value[0]?.provider_type || props.provider
)
const displayDomain = computed(() => currentDomainName.value || decodedDomain.value)
const recordsTarget = computed(() => decodedDomain.value)
const capabilities = computed(() => providerHook.value.capabilities)
const typeOptions = computed(() => {
  const types = [...new Set(records.value.map((record) => String(record.type || '')).filter(Boolean))]
  return types.sort().map((type) => ({ label: type, value: type }))
})
const importPreviewText = computed(() => {
  const preview = pendingImportRecords.value
    .slice(0, 8)
    .map((record, index) => `${index + 1}. ${record.name || '@'} ${record.type || '-'} ${record.value || ''}`)
    .join('\n')
  return pendingImportRecords.value.length > 8
    ? `${preview}\n... 另有 ${pendingImportRecords.value.length - 8} 条`
    : preview
})
const pagination = computed(() =>
  tablePagination({
    current: recordMeta.value.page || 1,
    pageSize: recordMeta.value.per_page || 20,
    total: recordMeta.value.total || 0,
    defaultPageSize: 20,
  })
)
const filteredRecords = computed(() => records.value)

onMounted(async () => {
  await load()
})

watch(
  () => props.provider,
  () => {
    currentProviderMeta.value = props.providerMeta || null
    resetAndLoad()
  }
)
watch(
  () => props.domain,
  () => {
    resetAndLoad()
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
function resetAndLoad() {
  clearSelection()
  editing.value = null
  showForm.value = false
  recordMeta.value = paginationState()
  keyword.value = ''
  appliedKeyword.value = ''
  currentDomainName.value = ''
  load()
}
function applyKeyword() {
  const nextKeyword = keyword.value.trim()
  if (nextKeyword === appliedKeyword.value && recordMeta.value.page === 1) return
  appliedKeyword.value = nextKeyword
  recordMeta.value.page = 1
  recordMeta.value.total = 0
  load()
}
function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  const next = nextPaginationState(recordMeta.value, pagination)
  if (!next) return
  recordMeta.value = next
  load()
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
    currentDomainName.value = decodedDomain.value
    const response = await dnsApi.records(props.provider, recordsTarget.value, {
      page: recordMeta.value.page,
      per_page: recordMeta.value.per_page,
      keyword: appliedKeyword.value,
      ...options,
    })
    if (!loadTask.isCurrent(requestToken)) return
    records.value = response.data
    recordMeta.value = mergePaginationMeta(recordMeta.value, response.meta || {})
    providerHook.value = resolveProviderHook(providerType.value)
    lines.value = providerHook.value.recordLines
  } catch (error) {
    if (!loadTask.isCurrent(requestToken)) return
    if (shouldReturnToDomains(error as { code?: string })) {
      await returnToDomains()
      return
    }
    message.error(errorMessage(error))
  } finally {
    if (loadTask.isCurrent(requestToken)) loading.value = false
  }
}
function shouldReturnToDomains(error: { code?: string }) {
  const notFoundCodes = [
    'provider_not_found',
    'provider_not_configured',
    'cloudflare_zone_not_found',
    'dnspod_zone_not_found',
    'edgeone_zone_not_found',
  ]
  return notFoundCodes.includes(error.code as string)
}
async function returnToDomains() {
  const path = providerPath(props.provider)
  message.warning('当前域名未添加解析，已返回域名列表。')
  await router.replace(path).catch(() => {})
}
function edit(record: DnsRecord) {
  editing.value = { ...record }
  showForm.value = true
}
function create() {
  editing.value = null
  showForm.value = true
}
function clearSelection() {
  selectedRecords.value = []
  selectionResetKey.value += 1
}
async function handleRefresh() {
  await load({ refresh: true })
  message.success('已刷新')
}
async function save(form: DnsRecord) {
  saving.value = true
  try {
    const recordOptions = { zoneName: displayDomain.value }
    if (form.id) await dnsApi.updateRecord(props.provider, recordsTarget.value, form.id, form, recordOptions)
    else await dnsApi.createRecord(props.provider, recordsTarget.value, form, recordOptions)
    message.success(form.id ? '记录已更新' : '记录已添加')
    showForm.value = false
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}
function askRemove(record: DnsRecord) {
  modal.confirm({
    title: '删除解析记录',
    content: `确认删除 ${record.name} · ${record.type}？删除后将立即同步到云服务商。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => remove(record),
  })
}
function askBatchRemove() {
  if (!selectedRecords.value.length) return
  const total = selectedRecords.value.length
  let dialog: ReturnType<typeof modal.confirm> | null = null
  dialog = modal.confirm({
    title: '批量删除解析记录',
    content: batchRemoveConfirmContent(total),
    okText: '批量删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => batchRemove(dialog, total),
  })
}
function batchRemoveConfirmContent(total: number) {
  const base = `确认删除已选的 ${total} 条解析记录？删除后将立即同步到云服务商。`
  return h('div', { style: 'white-space: pre-wrap' }, deletingText.value ? `${base}\n\n${deletingText.value}` : base)
}
function updateBatchRemoveDialog(dialog: ReturnType<typeof modal.confirm> | null, total: number) {
  dialog?.update?.({
    content: batchRemoveConfirmContent(total),
    cancelButtonProps: { disabled: deleting.value },
  })
}
async function remove(record: DnsRecord) {
  deleting.value = true
  try {
    await dnsApi.deleteRecord(props.provider, recordsTarget.value, record.id || '')
    message.success('已删除')
    clearSelection()
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
  } finally {
    deleting.value = false
    deletingText.value = ''
  }
}
async function batchRemove(dialog: ReturnType<typeof modal.confirm> | null, total: number) {
  deleting.value = true
  const failed: string[] = []
  try {
    deletingText.value = '正在删除 0/' + total
    updateBatchRemoveDialog(dialog, total)
    const records = [...selectedRecords.value]
    for (const [index, record] of records.entries()) {
      deletingText.value = `正在删除 ${index + 1}/${records.length}`
      updateBatchRemoveDialog(dialog, total)
      try {
        await dnsApi.deleteRecord(props.provider, recordsTarget.value, record.id || '')
      } catch (error) {
        failed.push(`${record.name} ${record.type}: ${errorMessage(error)}`)
      }
    }
    if (failed.length) showBatchFailures('批量删除完成', failed)
    else message.success('批量删除完成')
    clearSelection()
    await load({ refresh: true })
  } finally {
    deleting.value = false
    deletingText.value = ''
  }
}
function exportRecords() {
  const payload = records.value.map(({ id, provider, provider_type, provider_name, ...record }) => record)
  downloadJson(`${decodedDomain.value}-records.json`, payload)
}
async function importRecords() {
  try {
    const records = await chooseJsonFile()
    if (!records) return
    if (!Array.isArray(records)) throw new Error('导入文件必须是记录数组')
    pendingImportRecords.value = records as DnsRecord[]
    importMode.value = 'create'
    showImportConfirm.value = true
  } catch (error) {
    message.error(errorMessage(error))
  }
}
async function loadAllRecordsForImport() {
  const all: DnsRecord[] = []
  let page = 1
  const perPage = 20

  while (true) {
    const response = await dnsApi.records(props.provider, recordsTarget.value, {
      page,
      per_page: perPage,
      refresh: page === 1,
    })
    all.push(...response.data)
    const totalPages = Number(response.meta?.total_pages || 1)
    if (page >= totalPages) break
    page += 1
  }

  return all
}
function importMatchKey(record: DnsRecord) {
  const type = String(record.type || record.record_type || '').toUpperCase()
  const name = String(record.name || record.subdomain || '@')
    .trim()
    .toLowerCase()
  const line = String(record.line || record.record_line || '默认').trim()
  return `${name}__${type}__${line}`
}
async function confirmImport() {
  const records = pendingImportRecords.value
  if (!records.length) return
  showImportConfirm.value = false
  await batchImport(records, importMode.value)
}
async function batchImport(records: DnsRecord[], mode = 'create') {
  saving.value = true
  const failed: string[] = []
  try {
    const existingRecords = mode === 'overwrite' ? await loadAllRecordsForImport() : []
    const existingMap = new Map<string, DnsRecord>(existingRecords.map((record) => [importMatchKey(record), record]))

    for (const [index, record] of records.entries()) {
      deletingText.value = `正在导入 ${index + 1}/${records.length}`
      try {
        const key = importMatchKey(record)
        const existing = mode === 'overwrite' ? existingMap.get(key) : null
        if (existing?.id) {
          const updated = await dnsApi.updateRecord(
            props.provider,
            recordsTarget.value,
            existing.id,
            { ...existing, ...record },
            { zoneName: displayDomain.value }
          )
          const updatedData = updated?.data || existing
          existingMap.set(key, { ...updatedData, ...record, id: updatedData.id || existing.id })
        } else {
          const created = await dnsApi.createRecord(props.provider, recordsTarget.value, record, {
            zoneName: displayDomain.value,
          })
          existingMap.set(key, { ...record, id: created?.data?.id || '' })
        }
      } catch (error) {
        failed.push(`第 ${index + 1} 条 ${record.name || ''} ${record.type || ''}: ${errorMessage(error)}`)
      }
    }
    if (failed.length) showBatchFailures('导入完成', failed)
    else message.success('导入完成')
    await load({ refresh: true })
  } finally {
    saving.value = false
    deletingText.value = ''
    pendingImportRecords.value = []
  }
}
</script>
