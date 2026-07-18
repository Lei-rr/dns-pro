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
      v-if="deletingText"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
      :message="deletingText"
    />
    <BatchToolbar
      :count="selectedRecords.length"
      :deleting="deleting"
      delete-text="批量删除"
      :actions="batchActions"
      @action="onBatchAction"
      @delete="askBatchRemove"
      @clear="clearSelection"
    />
    <a-modal
      v-model:open="showBatchEdit"
      title="批量修改解析记录"
      :confirm-loading="deleting"
      ok-text="开始修改"
      cancel-text="取消"
      destroy-on-close
      @ok="confirmBatchEdit"
    >
      <a-form layout="vertical">
        <a-form-item :label="`记录值（已选 ${selectedRecords.length} 条，留空不改）`">
          <a-input v-model:value="batchEditForm.value" placeholder="不修改请留空" allow-clear />
        </a-form-item>
        <a-form-item label="TTL">
          <a-input-number v-model:value="batchEditForm.ttl" :min="1" :max="604800" style="width: 100%" placeholder="不修改请留空" />
        </a-form-item>
        <a-form-item v-if="showBatchLine" :label="providerHook.lineLabel || '线路'">
          <a-select v-model:value="batchEditForm.line" allow-clear placeholder="不修改请留空" style="width: 100%">
            <a-select-option v-for="line in lineOptions" :key="line.value" :value="line.value">{{ line.label }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item v-if="showBatchProxy">
          <a-checkbox v-model:checked="batchEditForm.proxiedEnabled">修改代理状态</a-checkbox>
          <a-checkbox v-if="batchEditForm.proxiedEnabled" v-model:checked="batchEditForm.proxied" style="margin-left: 12px">{{
            providerHook.proxyLabel || '已代理'
          }}</a-checkbox>
        </a-form-item>
        <a-form-item label="备注">
          <a-input v-model:value="batchEditForm.remark" placeholder="不修改请留空" allow-clear />
        </a-form-item>
        <a-form-item v-if="showBatchMx" label="MX 优先级">
          <a-input-number v-model:value="batchEditForm.priority" :min="0" :max="65535" style="width: 100%" placeholder="不修改请留空" />
        </a-form-item>
      </a-form>
    </a-modal>
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
import { useJobProgress } from '@/shared/composables/useJobProgress'
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
const showBatchEdit = ref(false)
const batchEditForm = ref({
  value: '',
  ttl: null as number | null,
  line: undefined as string | undefined,
  remark: '',
  priority: null as number | null,
  proxiedEnabled: false,
  proxied: false,
})
const jobProgress = useJobProgress()
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
const batchActions = computed(() => [{ key: 'edit', label: '批量修改', type: 'primary' }])
const showBatchLine = computed(() => {
  try {
    return Boolean(providerHook.value.showLine?.(lineOptions.value || []))
  } catch {
    return providerType.value === 'dnspod'
  }
})
const showBatchProxy = computed(() => providerType.value === 'cloudflare')
const lineOptions = computed(() => {
  if (lines.value?.length) return lines.value
  return [{ label: '默认', value: '默认' }]
})
const showBatchMx = computed(() =>
  selectedRecords.value.some((record) => String(record.type || '').toUpperCase() === 'MX'),
)
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
function onBatchAction(key: string) {
  if (key === 'edit') openBatchEdit()
}
function openBatchEdit() {
  if (!selectedRecords.value.length) return
  batchEditForm.value = {
    value: '',
    ttl: null,
    line: undefined,
    remark: '',
    priority: null,
    proxiedEnabled: false,
    proxied: false,
  }
  deletingText.value = ''
  showBatchEdit.value = true
}
function buildBatchPatch() {
  const form = batchEditForm.value
  const patch: Record<string, unknown> = {}
  const value = String(form.value || '').trim()
  if (value) patch.value = value
  if (form.ttl !== null && form.ttl !== undefined && String(form.ttl) !== '') patch.ttl = Number(form.ttl)
  if (form.line) patch.line = form.line
  const remark = String(form.remark || '').trim()
  if (remark) patch.remark = remark
  if (
    showBatchMx.value &&
    form.priority !== null &&
    form.priority !== undefined &&
    String(form.priority) !== ''
  ) {
    patch.priority = Number(form.priority)
    patch.mx = Number(form.priority)
  }
  if (form.proxiedEnabled) patch.proxied = !!form.proxied
  return patch
}
async function confirmBatchEdit() {
  const patch = buildBatchPatch()
  if (!Object.keys(patch).length) {
    message.warning('请至少填写一个要修改的字段')
    return Promise.reject()
  }
  showBatchEdit.value = false
  await batchUpdate(patch)
}
async function batchUpdate(patch: Record<string, unknown>) {
  if (!selectedRecords.value.length) return
  const total = selectedRecords.value.length
  deleting.value = true
  try {
    deletingText.value = `正在创建批量修改任务 0/${total}`
    const records = selectedRecords.value
      .map((record) => ({
        id: String(record.id || ''),
        name: String(record.name || ''),
        type: String(record.type || ''),
        value: String(record.value || record.content || ''),
        content: String(record.content || record.value || ''),
        ttl: record.ttl,
        line: record.line || record.record_line || '',
        record_line: record.record_line || record.line || '',
        record_line_id: record.record_line_id || '',
        mx: record.mx ?? record.priority,
        priority: record.priority ?? record.mx,
        remark: record.remark || record.comment || '',
        comment: record.comment || record.remark || '',
        proxied: record.proxied,
        subdomain: record.subdomain || record.name || '',
        status: record.status || '',
      }))
      .filter((item) => item.id)
    const created = await dnsApi.batchUpdateRecords(props.provider, recordsTarget.value, { records, patch })
    const jobId = String((created.data as any)?.id || '')
    if (!jobId) throw new Error('创建批量修改任务失败')

    const job = await jobProgress.pollJob(jobId, {
      fetchJob: async (id) => ((await dnsApi.batchJob(props.provider, id)).data as any) || {},
      onTick: (current) => {
        deletingText.value = current.current
          ? `后台修改 ${current.done || 0}/${current.total || total}：${current.current}`
          : `后台修改 ${current.done || 0}/${current.total || total}`
      },
    })

    const failedItems = jobProgress.failedItems(job)
    if (failedItems.length) {
      showBatchFailures(
        job?.message || '批量修改完成',
        failedItems.map((i: any) => `${i.name || ''} ${i.type || ''} ${i.record_id || ''}: ${i.message || '失败'}`),
        '条',
        {
          retryText: '重试失败项',
          onRetry: async () => {
            deleting.value = true
            deletingText.value = '正在重试失败项...'
            try {
              await dnsApi.batchRetry(props.provider, jobId)
              const retried = await jobProgress.pollJob(jobId, {
                fetchJob: async (id) => ((await dnsApi.batchJob(props.provider, id)).data as any) || {},
                label: '重试修改',
                onTick: (current) => {
                  deletingText.value = jobProgress.progressText(current, '重试修改')
                },
              })
              const again = jobProgress.failedItems(retried)
              if (again.length) message.warning(retried?.message || `仍有 ${again.length} 条失败`)
              else message.success(retried?.message || '重试完成')
              clearSelection()
              await load({ refresh: true })
            } catch (error) {
              message.error(errorMessage(error))
            } finally {
              deleting.value = false
              deletingText.value = ''
            }
          },
        },
      )
    } else {
      message.success(job?.message || '批量修改完成')
      clearSelection()
    }
    await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
    return Promise.reject(error)
  } finally {
    deleting.value = false
    deletingText.value = ''
  }
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
  try {
    deletingText.value = `正在创建批量删除任务 0/${total}`
    updateBatchRemoveDialog(dialog, total)
    const records = selectedRecords.value
      .map((record) => ({
        id: String(record.id || ''),
        name: String(record.name || ''),
        type: String(record.type || ''),
      }))
      .filter((item) => item.id)
    const created = await dnsApi.batchDeleteRecords(props.provider, recordsTarget.value, { records })
    const jobId = String((created.data as any)?.id || '')
    if (!jobId) throw new Error('创建批量删除任务失败')

    const job = await jobProgress.pollJob(jobId, {
      fetchJob: async (id) => ((await dnsApi.batchJob(props.provider, id)).data as any) || {},
      onTick: (current) => {
        deletingText.value = current.current
          ? `后台删除 ${current.done || 0}/${current.total || total}：${current.current}`
          : `后台删除 ${current.done || 0}/${current.total || total}`
        updateBatchRemoveDialog(dialog, total)
      },
    })

    const failedItems = jobProgress.failedItems(job)
    if (failedItems.length) {
      showBatchFailures(
        job?.message || '批量删除完成',
        failedItems.map((i: any) => `${i.name || ''} ${i.type || ''} ${i.record_id || ''}: ${i.message || '失败'}`),
        '条',
        {
          retryText: '重试失败项',
          onRetry: async () => {
            deleting.value = true
            deletingText.value = '正在重试失败项...'
            try {
              await dnsApi.batchRetry(props.provider, jobId)
              const retried = await jobProgress.pollJob(jobId, {
                fetchJob: async (id) => ((await dnsApi.batchJob(props.provider, id)).data as any) || {},
                label: '重试删除',
                onTick: (current) => {
                  deletingText.value = jobProgress.progressText(current, '重试删除')
                },
              })
              const again = jobProgress.failedItems(retried)
              if (again.length) message.warning(retried?.message || `仍有 ${again.length} 条失败`)
              else message.success(retried?.message || '重试完成')
              clearSelection()
              await load({ refresh: true })
            } catch (error) {
              message.error(errorMessage(error))
            } finally {
              deleting.value = false
              deletingText.value = ''
            }
          },
        },
      )
    } else {
      message.success(job?.message || '批量删除完成')
      clearSelection()
    }
    if (!failedItems.length) await load({ refresh: true })
    else await load({ refresh: true })
  } catch (error) {
    message.error(errorMessage(error))
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
