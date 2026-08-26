<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { FloatingSelectionBar } from '@/shared/ui/floating-selection-bar'
import { TablePagination } from '@/shared/ui/pagination'
import { Plus } from '@lucide/vue'
import { dnsApi, type DnsProviderRef } from '@/features/dns/api/dns-api'

import { parseRecordNames } from '@/features/dns/lib/record-names'
import { buildDnsRecordDisplayRows, dnsRecordMatchesKeyword, dnsRecordRowKey } from '@/features/dns/lib/record-display'
import { exportRecordsAsCsv, exportRecordsAsJson, exportRecordsAsZone } from '@/features/dns/lib/record-export'
import type { DnsRecord } from '@/features/dns/model/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { useRowBusy, removeListItem } from '@/shared/lib/row-busy'
import { formatFailedJobItem, JobProgressAlert, runBatchJob, showBatchFailures, useJobProgress } from '@/shared/job'
import type { JobLike } from '@/shared/job'
import RecordFormDialog from '@/features/dns/ui/RecordFormDialog.vue'
import BatchEditDialog from '@/features/dns/ui/BatchEditDialog.vue'
import RecordImportDialog from '@/features/dns/ui/RecordImportDialog.vue'
import RecordsToolbar from '@/features/dns/ui/RecordsToolbar.vue'
import RecordsTable from '@/features/dns/ui/RecordsTable.vue'
import type { ParsedImportRecord } from '@/features/dns/lib/record-import'
import { selectedAvailableRows, useRowSelection } from '@/shared/lib/row-selection'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'
import { createScopeGeneration, type ScopeOwner } from '@/shared/lib/scope-generation'
import { encodePath } from '@/shared/lib/path'

const props = defineProps<{ provider: DnsProviderRef; zoneId: string }>()
const providerId = computed(() => props.provider.id)
const router = useRouter()
const jobProgress = useJobProgress()
const { isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()
const scopeGeneration = createScopeGeneration()

type RecordsScope = { provider: DnsProviderRef; zoneId: string }

function captureScope(): ScopeOwner<RecordsScope> {
  return scopeGeneration.capture({ provider: { ...props.provider }, zoneId: props.zoneId })
}

const saving = ref(false)
const records = ref<DnsRecord[]>([])
const keyword = ref('')
const typeFilter = ref('all')
const dialogOpen = ref(false)
const batchEditOpen = ref(false)
const batchSubmitting = ref(false)
const batchEditError = ref('')
const editing = ref<DnsRecord | null>(null)
const formErrors = ref<FieldErrors>({})
const form = reactive({
  name: '',
  type: 'A',
  value: '',
  ttl: '600',
  line: '默认',
  remark: '',
  priority: '',
  proxied: false,
})
const batchPatch = reactive({
  value: '',
  ttl: '',
  line: '__keep',
  remark: '',
  priority: '',
  proxied: '__keep' as '__keep' | 'true' | 'false',
})

const isCloudflare = computed(() => props.provider.type === 'cloudflare')
const zoneName = computed(() => decodeURIComponent(props.zoneId))

const typeOptions = ['A', 'AAAA', 'CNAME', 'TXT', 'MX']
// DNSPod 常用线路（对齐旧 hook.recordLines）
const dnspodLineOptions = [
  { label: '默认', value: '默认' },
  { label: '境内', value: '境内' },
  { label: '电信', value: '电信' },
  { label: '联通', value: '联通' },
  { label: '移动', value: '移动' },
  { label: '境外', value: '境外' },
]
const filteredRecords = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return records.value.filter((record) => {
    if (typeFilter.value !== 'all' && String(record.type || '').toUpperCase() !== typeFilter.value) return false
    return !q || dnsRecordMatchesKeyword(record, q)
  })
})

const {
  loading,
  refreshing,
  pageSize,
  runLoad,
  onRefresh,
  onPageSizeChange: setPageSize,
  fail,
} = useListPage({
  pageSizeScope: 'dns-records',
  load: async (options = {}) => {
    try {
      const response = await dnsApi.records(props.provider, props.zoneId, { refresh: options.refresh })
      if (options.isLatest && !options.isLatest()) return false
      records.value = response.data || []
      return true
    } catch (error) {
      if (!options.isLatest || options.isLatest()) fail(error)
      return false
    }
  },
})

const { page, total, pagedItems: pagedRecords, resetPage } = useLocalPagination(filteredRecords, pageSize)
const displayRows = computed(() => buildDnsRecordDisplayRows(pagedRecords.value, zoneName.value))
/** 折叠状态：默认收起；搜索命中自动展开。 */
const expandedHosts = ref<Record<string, boolean>>({})
const selection = useRowSelection(pagedRecords, dnsRecordRowKey)
const selectedCount = computed(() => selection.selected.value.length)
watch([keyword, typeFilter], () => {
  resetPage()
  selection.clear()
  expandedHosts.value = {}
})
watch(
  [keyword, displayRows],
  () => {
    const q = keyword.value.trim().toLowerCase()
    if (!q) return
    const next: Record<string, boolean> = {}
    for (const row of displayRows.value) {
      if (
        row.kind === 'group' &&
        (row.records.some((record) => dnsRecordMatchesKeyword(record, q)) || row.label.toLowerCase().includes(q))
      ) {
        next[row.hostKey] = true
      }
    }
    expandedHosts.value = next
  },
  { flush: 'post' }
)

function onPageChange(next: number) {
  page.value = next
  selection.clear()
  expandedHosts.value = {}
}

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
  selection.clear()
  expandedHosts.value = {}
}

function onSearch() {
  resetPage()
}

function setTypeFilter(next: string) {
  typeFilter.value = next
}

function setSelectedKeys(keys: string[]) {
  selection.selected.value = keys
}

function openCreate() {
  editing.value = null
  formErrors.value = {}
  form.name = ''
  form.type = 'A'
  form.value = ''
  form.ttl = isCloudflare.value ? '1' : '600'
  form.line = '默认'
  form.remark = ''
  form.priority = ''
  form.proxied = false
  dialogOpen.value = true
}

function openEdit(record: DnsRecord) {
  editing.value = record
  formErrors.value = {}
  form.name = String(record.name || '')
  form.type = String(record.type || 'A')
  form.value = String(record.value || record.content || '')
  form.ttl = String(record.ttl ?? (isCloudflare.value ? '1' : '600'))
  form.line = String(record.line || '默认')
  form.remark = String(record.remark || record.comment || '')
  form.priority = String(record.priority ?? record.mx ?? '')
  form.proxied = !!record.proxied
  dialogOpen.value = true
}

async function save() {
  if (saving.value) return
  const scopeOwner = captureScope()
  const errors: FieldErrors = {}
  const names = parseRecordNames(form.name)
  const value = form.value.trim()
  if (!names.length) errors.name = '主机记录不能为空'
  if (!value) errors.value = '记录值不能为空'
  if (editing.value && names.length !== 1) errors.name = '编辑时只能填写一个主机记录'
  formErrors.value = errors
  if (Object.keys(errors).length) return

  saving.value = true
  try {
    const base = {
      type: form.type,
      value,
      ttl: Number(form.ttl) || (isCloudflare.value ? 1 : 600),
      line: form.line,
      remark: form.remark,
      priority: form.priority === '' ? undefined : Number(form.priority),
      proxied: form.proxied,
    }

    if (editing.value?.id) {
      await dnsApi.updateRecord(
        scopeOwner.value.provider,
        scopeOwner.value.zoneId,
        String(editing.value.id),
        { ...base, name: names[0] },
        { zoneName: decodeURIComponent(scopeOwner.value.zoneId) }
      )
      if (!scopeOwner.active()) return
      toast.success('记录已更新')
      dialogOpen.value = false
      await runLoad()
    } else if (names.length === 1) {
      await dnsApi.createRecord(
        scopeOwner.value.provider,
        scopeOwner.value.zoneId,
        { ...base, name: names[0] },
        { zoneName: decodeURIComponent(scopeOwner.value.zoneId) }
      )
      if (!scopeOwner.active()) return
      toast.success('记录已创建')
      dialogOpen.value = false
      await runLoad()
    } else {
      // 先关弹窗，才能看到页顶 JobProgressAlert
      dialogOpen.value = false
      saving.value = false
      await runBatchJob({
        label: '批量创建',
        create: () =>
          dnsApi.batchCreateRecords(props.provider, props.zoneId, {
            records: names.map((name) => ({ ...base, name })),
          }),
        fetchJob: async (id) => ((await dnsApi.batchJob(props.provider, id)).data as Record<string, unknown>) || {},
        retry: (id) => dnsApi.batchRetry(props.provider, id),
        onDone: () => runLoad(),
        jobProgress,
      })
      return
    }
  } catch (error) {
    if (!scopeOwner.active()) return
    formErrors.value = {
      ...formErrors.value,
      ...serverFieldErrors(error, {
        subdomain: 'name',
        record_type: 'type',
        content: 'value',
      }),
    }
    toast.error(errorMessage(error))
  } finally {
    if (scopeOwner.active()) saving.value = false
  }
}

async function removeRecord(record: DnsRecord) {
  const scopeOwner = captureScope()
  const key = String(record.id || `${record.name}-${record.type}-${record.value || ''}`)
  const recordId = String(record.id || '')
  if (!(await confirmDelete(`${record.name} · ${record.type}`)) || !scopeOwner.active()) return
  await runBusy(key, async (owner) => {
    if (!scopeOwner.active()) return
    try {
      await dnsApi.deleteRecord(scopeOwner.value.provider, scopeOwner.value.zoneId, recordId)
      if (!scopeOwner.active() || !owner.active()) return
      toast.success('已删除')
      removeListItem(records, (item) => String(item.id || '') === recordId && recordId !== '')
      // id 可能空：按复合键再试
      removeListItem(records, (item) => String(item.id || `${item.name}-${item.type}-${item.value || ''}`) === key)
      selection.clear()
    } catch (error) {
      if (scopeOwner.active() && owner.active()) toast.error(errorMessage(error))
    }
  })
}

async function copyRecordValue(record: DnsRecord | { value?: string; content?: string }) {
  const text = String(record.value || record.content || '').trim()
  if (!text) {
    toast.warning('无可复制内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制')
  } catch {
    toast.warning('复制失败，请手动选择')
  }
}

async function runDnsBatch(
  scopeOwner: ScopeOwner<RecordsScope>,
  create: () => Promise<{ data?: unknown }>,
  label: string
) {
  if (!scopeOwner.active()) return null
  return runBatchJob({
    label,
    create: () => (scopeOwner.active() ? create() : Promise.resolve({ data: undefined })),
    fetchJob: async (id) =>
      ((await dnsApi.batchJob(scopeOwner.value.provider, id)).data as Record<string, unknown>) || {},
    retry: (id) => dnsApi.batchRetry(scopeOwner.value.provider, id),
    clearSelection: () => {
      if (scopeOwner.active()) selection.clear()
    },
    onDone: () => (scopeOwner.active() ? runLoad() : undefined),
    jobProgress,
  })
}

function captureSelectedRecords() {
  const selectedKeys = [...selection.selected.value]
  return {
    selectedKeys,
    selectedRows: selectedAvailableRows(pagedRecords.value, selectedKeys, dnsRecordRowKey, (row) =>
      isRowBusy(dnsRecordRowKey(row))
    ),
  }
}

async function batchDeleteSelected() {
  const scopeOwner = captureScope()
  const { selectedRows } = captureSelectedRecords()
  if (!selectedRows.length) {
    toast.warning('请先勾选记录')
    return
  }
  if (
    !(await confirmDialog({
      title: '批量删除',
      description: `确认删除已选 ${selectedRows.length} 条记录？`,
      confirmText: '删除',
      destructive: true,
    }))
  )
    return
  if (!scopeOwner.active()) return
  const payload = selectedRows
    .filter((row) => !isRowBusy(dnsRecordRowKey(row)))
    .map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || ''),
      type: String(row.type || ''),
    }))
  if (!payload.length) return
  try {
    await runDnsBatch(
      scopeOwner,
      () => dnsApi.batchDeleteRecords(scopeOwner.value.provider, scopeOwner.value.zoneId, { records: payload }),
      '批量删除'
    )
  } catch (error) {
    if (scopeOwner.active()) toast.error(errorMessage(error))
  }
}

/** 打开批量修改表单弹窗（底部「批量管理」） */
function openBatchEdit() {
  if (!selection.selected.value.length) {
    toast.warning('请先勾选记录')
    return
  }
  batchPatch.value = ''
  batchPatch.ttl = ''
  batchPatch.line = '__keep'
  batchPatch.remark = ''
  batchPatch.priority = ''
  batchPatch.proxied = '__keep'
  batchEditError.value = ''
  batchEditOpen.value = true
}

async function batchUpdateSelected() {
  if (batchSubmitting.value) return
  const scopeOwner = captureScope()
  const { selectedRows } = captureSelectedRecords()
  const patch: Record<string, unknown> = {}
  if (batchPatch.value.trim()) patch.value = batchPatch.value.trim()
  if (batchPatch.ttl.trim()) patch.ttl = Number(batchPatch.ttl) || batchPatch.ttl
  if (batchPatch.line && batchPatch.line !== '__keep') patch.line = batchPatch.line
  if (batchPatch.remark.trim()) patch.remark = batchPatch.remark.trim()
  if (batchPatch.priority.trim()) patch.priority = Number(batchPatch.priority)
  if (batchPatch.proxied === 'true' || batchPatch.proxied === 'false') {
    patch.proxied = batchPatch.proxied === 'true'
  }
  batchEditError.value = Object.keys(patch).length ? '' : '请至少填写一项要修改的字段'
  if (batchEditError.value) return
  const payload = selectedRows
    .filter((row) => !isRowBusy(dnsRecordRowKey(row)))
    .map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || ''),
      type: String(row.type || ''),
      value: String(row.value || row.content || ''),
      ttl: row.ttl,
      line: row.line,
      remark: row.remark || row.comment,
      priority: row.priority ?? row.mx,
      proxied: row.proxied,
    }))
  if (!payload.length) return
  batchSubmitting.value = true
  batchEditOpen.value = false
  try {
    await runDnsBatch(
      scopeOwner,
      () =>
        dnsApi.batchUpdateRecords(scopeOwner.value.provider, scopeOwner.value.zoneId, {
          records: payload,
          patch,
        }),
      '批量修改'
    )
  } catch (error) {
    if (scopeOwner.active()) toast.error(errorMessage(error))
  } finally {
    if (scopeOwner.active()) batchSubmitting.value = false
  }
}

async function resumeJobs() {
  if (jobProgress.running.value) return
  const scopeOwner = captureScope()
  const finished = await jobProgress.resumeActive(
    () => dnsApi.batchActive(scopeOwner.value.provider, scopeOwner.value.zoneId),
    {
      label: 'DNS 批量',
      fetchJob: async (id) => ((await dnsApi.batchJob(props.provider, id)).data as JobLike) || {},
    }
  )
  if (finished) {
    const jobId = String(finished.id || '')
    const failed = jobProgress.failedItems(finished)
    if (failed.length) {
      await showBatchFailures(
        finished.message || 'DNS 批量完成',
        failed.map((i) => formatFailedJobItem(i)),
        '条',
        {
          onRetry: async () => {
            if (!scopeOwner.active()) return null
            await dnsApi.batchRetry(scopeOwner.value.provider, jobId)
            if (!scopeOwner.active()) return null
            return jobProgress.pollJob(jobId, {
              label: 'DNS 批量',
              fetchJob: async (id) => ((await dnsApi.batchJob(scopeOwner.value.provider, id)).data as JobLike) || {},
            })
          },
          isActive: () => scopeOwner.active(),
        }
      )
    }
    await runLoad()
  }
}

watch(
  () => [providerId.value, props.provider.type, props.zoneId],
  async () => {
    scopeGeneration.invalidate()
    dialogOpen.value = false
    batchEditOpen.value = false
    editing.value = null
    saving.value = false
    batchSubmitting.value = false
    jobProgress.reset()
    resetRowOperations()
    selection.clear()
    records.value = []
    await runLoad()
    await resumeJobs()
  }
)

onUnmounted(() => {
  scopeGeneration.invalidate()
  jobProgress.reset()
  resetRowOperations()
})

onMounted(async () => {
  await runLoad()
  await resumeJobs()
})
const importOpen = ref(false)
const importSubmitting = ref(false)

async function handleImportSubmit(parsedRecords: ParsedImportRecord[]) {
  importSubmitting.value = true
  try {
    importOpen.value = false
    await runBatchJob({
      label: '批量导入',
      create: () =>
        dnsApi.batchCreateRecords(props.provider, props.zoneId, {
          records: parsedRecords,
        }),
      fetchJob: async (id) => ((await dnsApi.batchJob(props.provider, id)).data as Record<string, unknown>) || {},
      retry: (id) => dnsApi.batchRetry(props.provider, id),
      onDone: () => runLoad(),
      jobProgress,
    })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    importSubmitting.value = false
  }
}

function handleExport(format: 'json' | 'csv' | 'zone') {
  if (!records.value.length) {
    toast.warning('当前暂无可导出的 DNS 记录')
    return
  }
  const name = zoneName.value || 'zone'
  if (format === 'json') {
    exportRecordsAsJson(records.value, name)
  } else if (format === 'csv') {
    exportRecordsAsCsv(records.value, name)
  } else if (format === 'zone') {
    exportRecordsAsZone(records.value, name)
  }
  toast.success(`已导出 ${records.value.length} 条记录 (${format.toUpperCase()})`)
}
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="zoneName" :description="`${provider.name || providerId} · 解析记录`">
      <Button variant="outline" size="sm" @click="router.push('/' + encodePath(providerId))">返回域名</Button>
      <Button size="sm" @click="openCreate">
        <Plus class="size-4" />
        添加记录
      </Button>
    </PageHeader>

    <JobProgressAlert
      :running="jobProgress.running.value"
      :text="jobProgress.text.value"
      title="DNS 批量任务"
      :status="jobProgress.job.value?.status"
      :percent="jobProgress.percent.value"
    />

    <RecordsToolbar
      v-model:keyword="keyword"
      :type-filter="typeFilter"
      :type-options="typeOptions"
      :loading="loading"
      :refreshing="refreshing"
      @search="onSearch"
      @refresh="onRefresh"
      @update:type-filter="setTypeFilter"
      @export="handleExport"
      @import="importOpen = true"
    />

    <RecordsTable
      :rows="displayRows"
      :records="pagedRecords"
      :selected-keys="selection.selected.value"
      :expanded-hosts="expandedHosts"
      :zone-name="zoneName"
      :is-cloudflare="isCloudflare"
      :loading="loading"
      :refreshing="refreshing"
      :busy="isRowBusy"
      @update:selected-keys="setSelectedKeys"
      @update:expanded-hosts="expandedHosts = $event"
      @edit="openEdit"
      @remove="removeRecord"
      @copy="copyRecordValue"
    />

    <TablePagination
      :page="page"
      :page-size="pageSize"
      :total="total"
      :disabled="loading"
      @update:page="onPageChange"
      @update:page-size="onPageSizeChange"
    />

    <!-- 勾选后：底部悬浮操作条 -->
    <FloatingSelectionBar
      :show="selectedCount > 0 && !jobProgress.running.value"
      :count="selectedCount"
      :disabled="jobProgress.running.value || batchSubmitting"
      @clear="selection.clear()"
    >
      <Button
        size="sm"
        class="h-7 px-3 text-xs cursor-pointer"
        :disabled="jobProgress.running.value || batchSubmitting"
        @click="openBatchEdit"
      >
        批量管理
      </Button>
      <Button
        size="sm"
        variant="destructive"
        class="h-7 px-3 text-xs cursor-pointer"
        :disabled="jobProgress.running.value || batchSubmitting"
        @click="batchDeleteSelected"
      >
        批量删除
      </Button>
    </FloatingSelectionBar>

    <RecordFormDialog
      v-model:open="dialogOpen"
      v-model:form="form"
      :editing="!!editing"
      :saving="saving"
      :is-cloudflare="isCloudflare"
      :type-options="typeOptions"
      :line-options="dnspodLineOptions"
      :errors="formErrors"
      @save="save"
    />

    <BatchEditDialog
      v-model:open="batchEditOpen"
      v-model:patch="batchPatch"
      :selected-count="selectedCount"
      :is-cloudflare="isCloudflare"
      :line-options="dnspodLineOptions"
      :error="batchEditError"
      @submit="batchUpdateSelected"
    />

    <RecordImportDialog
      v-model:open="importOpen"
      :zone-name="zoneName"
      :submitting="importSubmitting"
      @submit="handleImportSubmit"
    />
  </div>
</template>
