<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { TablePagination } from '@/shared/ui/pagination'
import { dnsApi, type DnsProviderRef } from '@/features/dns/api/dns-api'
import { buildDnsRecordDisplayRows, dnsRecordMatchesKeyword, dnsRecordRowKey } from '@/features/dns/lib/record-display'
import { exportRecordsAsCsv, exportRecordsAsJson, exportRecordsAsZone } from '@/features/dns/lib/record-export'
import type { DnsRecord } from '@/features/dns/model/types'
import type { ImportPlan } from '@/features/dns/lib/record-import-preview'
import { useDnsLinesQuery, useDnsRecordsQuery } from '@/features/dns/model/use-records-query'
import { useRecordForm } from '@/features/dns/model/use-record-form'
import { useRecordsBatch } from '@/features/dns/model/use-records-batch'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { useRowBusy } from '@/shared/lib/row-busy'
import { createScopeGeneration } from '@/shared/lib/scope-generation'
import { JobProgressAlert, useJobProgress } from '@/shared/job'
import { selectedAvailableRows, useRowSelection } from '@/shared/lib/row-selection'
import { confirmDelete } from '@/shared/ui/confirm'
import { encodePath } from '@/shared/lib/path'
import RecordsToolbar from '@/features/dns/ui/RecordsToolbar.vue'
import RecordsTable from '@/features/dns/ui/RecordsTable.vue'
import RecordsSelectionBar from '@/features/dns/ui/RecordsSelectionBar.vue'
import RecordFormDialog from '@/features/dns/ui/RecordFormDialog.vue'
import BatchEditDialog from '@/features/dns/ui/BatchEditDialog.vue'
import RecordImportDialog from '@/features/dns/ui/RecordImportDialog.vue'

const props = defineProps<{ provider: DnsProviderRef; zoneId: string }>()
const router = useRouter()
const jobProgress = useJobProgress()
const { isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()
/** 写路径作用域快照：确认弹窗期间路由可能已切到别的 provider/zone */
const writeScope = createScopeGeneration()

const providerId = computed(() => props.provider.id)
const isCloudflare = computed(() => props.provider.type === 'cloudflare')
// 路由参数可能含畸形百分号编码，解码失败时回退原值而不是中断渲染。
const zoneName = computed(() => {
  try {
    return decodeURIComponent(props.zoneId)
  } catch {
    return props.zoneId
  }
})

const recordsQuery = useDnsRecordsQuery(
  () => props.provider,
  () => props.zoneId
)
const linesQuery = useDnsLinesQuery({
  provider: () => props.provider,
  zoneName,
  cloudflare: isCloudflare,
})
const records = recordsQuery.records

function lineIdOf(line: string): string | undefined {
  return linesQuery.lines.value.find((option) => option.value === line)?.lineId
}

const keyword = ref('')
const typeFilter = ref('all')
const typeOptions = ['A', 'AAAA', 'CNAME', 'TXT', 'MX']

const recordForm = useRecordForm({
  provider: () => props.provider,
  zoneId: () => props.zoneId,
  zoneName,
  cloudflare: isCloudflare,
  lineIdOf,
  invalidate: recordsQuery.invalidate,
  jobProgress,
})

const filteredRecords = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return records.value.filter((record) => {
    if (typeFilter.value !== 'all' && String(record.type || '').toUpperCase() !== typeFilter.value) return false
    return !q || dnsRecordMatchesKeyword(record, q)
  })
})

const { page, total, pagedItems: pagedRecords, resetPage } = useLocalPagination(filteredRecords, recordsQuery.pageSize)
const displayRows = computed(() => buildDnsRecordDisplayRows(pagedRecords.value, zoneName.value))
/** 折叠状态：默认收起；搜索命中自动展开。 */
const expandedHosts = ref<Record<string, boolean>>({})
const selection = useRowSelection(pagedRecords, dnsRecordRowKey)
const selectedCount = computed(() => selection.selected.value.length)

function currentSelectedRows(): DnsRecord[] {
  return selectedAvailableRows(pagedRecords.value, selection.selected.value, dnsRecordRowKey, (row) =>
    isRowBusy(dnsRecordRowKey(row))
  )
}

const batch = useRecordsBatch({
  provider: () => props.provider,
  zoneId: () => props.zoneId,
  zoneName,
  lineIdOf,
  jobProgress,
  invalidate: recordsQuery.invalidate,
  selectedRows: currentSelectedRows,
  clearSelection: () => selection.clear(),
})

/** 保证当前编辑/批量选择中的线路始终可选项，避免历史线路值丢失 */
const dnspodLineOptions = computed(() => {
  const options = linesQuery.lines.value
  const current = [recordForm.form.line, batch.batchPatch.line].filter(
    (line) => line && line !== '__keep' && !options.some((option) => option.value === line)
  )
  return [...options, ...current.map((line) => ({ label: line, value: line }))]
})

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
  recordsQuery.setPageSize(next)
  resetPage()
  selection.clear()
  expandedHosts.value = {}
}

function onSearch() {
  resetPage()
}

async function handleRefresh() {
  // 记录与线路一起刷新，避免线路加载失败后永久走回退列表
  await Promise.all([recordsQuery.refresh(), linesQuery.refresh()])
}

async function removeRecord(record: DnsRecord) {
  const recordId = String(record.id || '')
  // 缺少 ID 时请求会落到集合路径（404），与编辑路径同约定：明确报错并要求刷新
  if (!recordId) {
    toast.error('该记录缺少 ID，无法删除，请刷新后重试')
    return
  }
  // 确认弹窗期间可能切换作用域：先快照 provider/zone，请求只用快照值
  const scopeOwner = writeScope.capture({ provider: { ...props.provider }, zoneId: props.zoneId })
  if (!(await confirmDelete(`${record.name} · ${record.type}`))) return
  if (!scopeOwner.active()) return
  await runBusy(dnsRecordRowKey(record), async (owner) => {
    try {
      await dnsApi.deleteRecord(scopeOwner.value.provider, scopeOwner.value.zoneId, recordId)
      if (!owner.active() || !scopeOwner.active()) return
      toast.success('已删除')
      selection.clear()
      await recordsQuery.invalidate()
    } catch (error) {
      if (owner.active() && scopeOwner.active()) toast.error(errorMessage(error))
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

function handleImportSubmit(plan: ImportPlan) {
  void batch.submitImport(plan)
}

function handleExport(format: 'json' | 'csv' | 'zone') {
  // 导出当前筛选结果，避免与界面显示不一致
  const rows = filteredRecords.value
  if (!rows.length) {
    toast.warning('当前暂无可导出的 DNS 记录')
    return
  }
  const name = zoneName.value || 'zone'
  if (format === 'json') exportRecordsAsJson(rows, name)
  else if (format === 'csv') exportRecordsAsCsv(rows, name)
  else if (format === 'zone') exportRecordsAsZone(rows, name)
  toast.success(`已导出 ${rows.length} 条记录 (${format.toUpperCase()})`)
}

watch([providerId, () => props.provider.type, () => props.zoneId], () => {
  writeScope.invalidate()
  recordForm.dialogOpen.value = false
  batch.batchEditOpen.value = false
  batch.invalidateScope()
  jobProgress.reset()
  resetRowOperations()
  selection.clear()
  expandedHosts.value = {}
  // 搜索词属于上一个域名：不清理会让新记录列表被旧关键词过滤成空表
  keyword.value = ''
  resetPage()
  void batch.resumeJobs()
})

onMounted(() => {
  void batch.resumeJobs()
})

onUnmounted(() => {
  writeScope.invalidate()
  batch.invalidateScope()
  jobProgress.reset()
  resetRowOperations()
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="zoneName" :description="`${provider.name || providerId} · 解析记录`">
      <Button variant="outline" size="sm" @click="router.push('/' + encodePath(providerId))">返回域名</Button>
      <Button size="sm" @click="recordForm.openCreate">
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
      :loading="recordsQuery.loading.value"
      :refreshing="recordsQuery.refreshing.value"
      @search="onSearch"
      @refresh="handleRefresh"
      @update:type-filter="typeFilter = $event"
      @export="handleExport"
      @import="batch.importOpen.value = true"
    />

    <RecordsTable
      :rows="displayRows"
      :records="pagedRecords"
      :selected-keys="selection.selected.value"
      :expanded-hosts="expandedHosts"
      :zone-name="zoneName"
      :is-cloudflare="isCloudflare"
      :loading="recordsQuery.loading.value"
      :refreshing="recordsQuery.refreshing.value"
      :busy="isRowBusy"
      @update:selected-keys="selection.selected.value = $event"
      @update:expanded-hosts="expandedHosts = $event"
      @edit="recordForm.openEdit"
      @remove="removeRecord"
      @copy="copyRecordValue"
    />

    <TablePagination
      :page="page"
      :page-size="recordsQuery.pageSize.value"
      :total="total"
      :disabled="recordsQuery.loading.value"
      @update:page="onPageChange"
      @update:page-size="onPageSizeChange"
    />

    <RecordsSelectionBar
      :show="selectedCount > 0 && !jobProgress.running.value"
      :count="selectedCount"
      :disabled="jobProgress.running.value || batch.batchSubmitting.value"
      @clear="selection.clear()"
      @edit="batch.openBatchEdit"
      @remove="batch.batchDeleteSelected"
    />

    <RecordFormDialog
      v-model:open="recordForm.dialogOpen.value"
      v-model:form="recordForm.form"
      :editing="!!recordForm.editing.value"
      :saving="recordForm.saving.value"
      :is-cloudflare="isCloudflare"
      :type-options="typeOptions"
      :line-options="dnspodLineOptions"
      :errors="recordForm.formErrors.value"
      @save="recordForm.save"
    />

    <BatchEditDialog
      v-model:open="batch.batchEditOpen.value"
      v-model:patch="batch.batchPatch"
      :selected-count="selectedCount"
      :is-cloudflare="isCloudflare"
      :line-options="dnspodLineOptions"
      :error="batch.batchEditError.value"
      @submit="batch.batchUpdateSelected"
    />

    <RecordImportDialog
      v-model:open="batch.importOpen.value"
      :zone-name="zoneName"
      :existing-records="records"
      :submitting="batch.importSubmitting.value"
      @submit="handleImportSubmit"
    />
  </div>
</template>
