<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { TablePagination } from '@/shared/ui/pagination'
import { Plus } from '@lucide/vue'
import { dnsApi } from '@/features/dns/api/dns'
import { getCachedProvider, loadProviders } from '@/features/providers/stores/providers'
import { providerPath } from '@/features/providers/lib/paths'
import { parseRecordNames } from '@/features/dns/lib/record-names'
import { buildDnsRecordDisplayRows, dnsRecordMatchesKeyword, dnsRecordRowKey } from '@/features/dns/lib/record-display'
import type { DnsRecord } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { useRowBusy, removeListItem } from '@/shared/lib/row-busy'
import { JobProgressAlert } from '@/shared/ui/job-progress'
import { useJobProgress } from '@/shared/lib/job-progress'
import { formatFailedJobItem, showBatchFailures } from '@/shared/lib/batch'
import { runProviderBatch } from '@/shared/lib/run-provider-batch'
import type { JobLike } from '@/shared/lib/job-progress'
import RecordFormDialog from '@/features/dns/components/RecordFormDialog.vue'
import BatchEditDialog from '@/features/dns/components/BatchEditDialog.vue'
import RecordsToolbar from '@/features/dns/components/RecordsToolbar.vue'
import RecordsTable from '@/features/dns/components/RecordsTable.vue'
import { useRowSelection } from '@/shared/lib/row-selection'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'

const props = defineProps<{ providerId: string; zoneId: string }>()
const router = useRouter()
const jobProgress = useJobProgress()
const { isBusy: isRowBusy, runBusy } = useRowBusy()

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

const provider = computed(() => getCachedProvider(props.providerId))
const isCloudflare = computed(() => provider.value?.type === 'cloudflare')
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

const { loading, refreshing, pageSize, runLoad, onRefresh, onPageSizeChange: setPageSize, fail } = useListPage({
  pageSizeScope: 'dns-records',
  load: async (options = {}) => {
    try {
      const response = await dnsApi.records(props.providerId, props.zoneId, { refresh: options.refresh })
      if (options.isLatest && !options.isLatest()) return false
      records.value = response.data || []
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
      if (row.kind === 'group' && (row.records.some((record) => dnsRecordMatchesKeyword(record, q)) || row.label.toLowerCase().includes(q))) {
        next[row.hostKey] = true
      }
    }
    expandedHosts.value = next
  },
  { flush: 'post' },
)

async function ensureProvider() {
  if (!getCachedProvider(props.providerId)) await loadProviders({ force: true })
  if (!getCachedProvider(props.providerId)) {
    toast.warning('服务商不可用')
    router.replace('/')
  }
}

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
        props.providerId,
        props.zoneId,
        String(editing.value.id),
        { ...base, name: names[0] },
        { zoneName: zoneName.value },
      )
      toast.success('记录已更新')
      dialogOpen.value = false
      await runLoad()
    } else if (names.length === 1) {
      await dnsApi.createRecord(
        props.providerId,
        props.zoneId,
        { ...base, name: names[0] },
        { zoneName: zoneName.value },
      )
      toast.success('记录已创建')
      dialogOpen.value = false
      await runLoad()
    } else {
      // 先关弹窗，才能看到页顶 JobProgressAlert
      dialogOpen.value = false
      saving.value = false
      await runProviderBatch({
        label: '批量创建',
        create: () => dnsApi.batchCreateRecords(props.providerId, props.zoneId, {
          zone_name: zoneName.value,
          records: names.map((name) => ({ ...base, name })),
        }),
        fetchJob: async (id) => ((await dnsApi.batchJob(props.providerId, id)).data as Record<string, unknown>) || {},
        retry: (id) => dnsApi.batchRetry(props.providerId, id),
        onDone: () => runLoad(),
        jobProgress,
      })
      return
    }
  } catch (error) {
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
    saving.value = false
  }
}

async function removeRecord(record: DnsRecord) {
  if (!(await confirmDelete(`${record.name} · ${record.type}`))) return
  const key = String(record.id || `${record.name}-${record.type}-${record.value || ''}`)
  await runBusy(key, async () => {
    try {
      await dnsApi.deleteRecord(props.providerId, props.zoneId, String(record.id || ''))
      toast.success('已删除')
      removeListItem(
        records,
        (item) => String(item.id || '') === String(record.id || '') && String(item.id || '') !== '',
      )
      // id 可能空：按复合键再试
      removeListItem(
        records,
        (item) =>
          String(item.id || `${item.name}-${item.type}-${item.value || ''}`) === key,
      )
      selection.clear()
    } catch (error) {
      toast.error(errorMessage(error))
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
  create: () => Promise<{ data?: unknown }>,
  label: string,
) {
  await runProviderBatch({
    label,
    create,
    fetchJob: async (id) => ((await dnsApi.batchJob(props.providerId, id)).data as Record<string, unknown>) || {},
    retry: (id) => dnsApi.batchRetry(props.providerId, id),
    clearSelection: () => selection.clear(),
    onDone: () => runLoad(),
    jobProgress,
  })
}

async function batchDeleteSelected() {
  const ids = selection.selected.value
  if (!ids.length) {
    toast.warning('请先勾选记录')
    return
  }
  if (!(await confirmDialog({ title: '批量删除', description: `确认删除已选 ${ids.length} 条记录？`, confirmText: '删除', destructive: true }))) return
  const payload = selection.selectedRows.value.map((row) => ({
    id: String(row.id || ''),
    name: String(row.name || ''),
    type: String(row.type || ''),
  }))
  try {
    await runDnsBatch(
      () => dnsApi.batchDeleteRecords(props.providerId, props.zoneId, { records: payload }),
      '批量删除',
    )
  } catch (error) {
    toast.error(errorMessage(error))
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
  const payload = selection.selectedRows.value.map((row) => ({
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
  batchSubmitting.value = true
  batchEditOpen.value = false
  try {
    await runDnsBatch(
      () =>
        dnsApi.batchUpdateRecords(props.providerId, props.zoneId, {
          records: payload,
          patch,
        }),
      '批量修改',
    )
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    batchSubmitting.value = false
  }
}

async function resumeJobs() {
  if (jobProgress.running.value) return
  const finished = await jobProgress.resumeActive(
    () => dnsApi.batchActive(props.providerId, props.zoneId),
    {
      label: 'DNS 批量',
      fetchJob: async (id) => ((await dnsApi.batchJob(props.providerId, id)).data as JobLike) || {},
    },
  )
  if (finished) {
    const failed = jobProgress.failedItems(finished)
    if (failed.length) {
      showBatchFailures(finished.message || 'DNS 批量完成', failed.map((i) => formatFailedJobItem(i)), '条')
    }
    await runLoad()
  }
}

watch(
  () => [props.providerId, props.zoneId],
  async () => {
    selection.clear()
    await ensureProvider()
    await runLoad()
    await resumeJobs()
  },
)

onMounted(async () => {
  await ensureProvider()
  await runLoad()
  await resumeJobs()
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="zoneName" :description="`${provider?.name || providerId} · 解析记录`">
      <Button variant="outline" size="sm" @click="router.push(providerPath(providerId))">返回域名</Button>
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
    />

    <RecordsTable
      :rows="displayRows"
      :records="pagedRecords"
      :selected-keys="selection.selected.value"
      :expanded-hosts="expandedHosts"
      :zone-name="zoneName"
      :is-cloudflare="isCloudflare"
      :loading="loading"
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

    <!-- 勾选后：底部居中操作条 -->
    <div
      v-if="selectedCount && !jobProgress.running.value"
      class="pointer-events-none sticky bottom-4 z-20 flex justify-center px-2"
    >
      <div
        class="bg-card pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border px-3 py-2 shadow-md"
      >
        <span class="text-muted-foreground px-1 text-sm whitespace-nowrap">
          已选 {{ selectedCount }}
        </span>
        <Button size="sm" :disabled="jobProgress.running.value || batchSubmitting" @click="openBatchEdit">
          批量管理
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="text-destructive"
          :disabled="jobProgress.running.value || batchSubmitting"
          @click="batchDeleteSelected"
        >
          批量删除
        </Button>
        <Button size="sm" variant="ghost" @click="selection.clear()">取消</Button>
      </div>
    </div>

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
  </div>
</template>
