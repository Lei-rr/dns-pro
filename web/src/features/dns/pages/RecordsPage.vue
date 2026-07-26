<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableLoading } from '@/shared/ui/table'
import { TablePagination } from '@/shared/ui/pagination'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { EllipsisVertical, Plus, RefreshCw, Search, ChevronRight, ChevronDown, Copy } from '@lucide/vue'
import { dnsApi } from '@/features/dns/api/dns'
import { getCachedProvider, loadProviders } from '@/features/providers/stores/providers'
import { providerPath } from '@/features/providers/lib/paths'
import { parseRecordNames } from '@/features/dns/lib/record-names'
import {
  compareRecordsForGroup,
  recordHostKey,
  hostGroupLabel,
  orderedPurposeLabels,
  shouldCollapseHostGroup,
} from '@/features/dns/lib/record-remark'
import type { DnsRecord } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { handleRefresh, withMinLoading } from '@/shared/lib/loading'
import { loadPageSize, savePageSize } from '@/shared/lib/page-size'
import { JobProgressAlert } from '@/shared/ui/job-progress'
import { useJobProgress } from '@/shared/lib/job-progress'
import { formatFailedJobItem, showBatchFailures } from '@/shared/lib/batch'
import { useRowSelection } from '@/shared/lib/row-selection'
import { Checkbox } from '@/shared/ui/checkbox'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

const props = defineProps<{ providerId: string; zoneId: string }>()
const router = useRouter()
const jobProgress = useJobProgress()

const loading = ref(false)
const refreshing = ref(false)
const saving = ref(false)
const records = ref<DnsRecord[]>([])
const keyword = ref('')
const typeFilter = ref('all')
const page = ref(1)
const pageSize = ref(loadPageSize('dns-records'))
const total = ref(0)
const dialogOpen = ref(false)
const batchEditOpen = ref(false)
const editing = ref<DnsRecord | null>(null)
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
  const list =
    typeFilter.value === 'all'
      ? [...records.value]
      : records.value.filter((r) => String(r.type || '').toUpperCase() === typeFilter.value)
  // 同主机（备注 FQDN / 主机名）聚组：默认回源 → 优选 → DCV → 其它
  list.sort((a, b) => compareRecordsForGroup(a, b, zoneName.value))
  return list
})

type DisplayRow =
  | { kind: 'single'; record: DnsRecord; key: string }
  | { kind: 'group'; hostKey: string; label: string; records: DnsRecord[]; key: string }

/**
 * 当前页按主机前缀 / 邮箱套件聚组：
 * - api(默认)+api(境内)+_acme-challenge.api
 * - MX/SPF/DKIM/DMARC → @zone
 * 折叠组一律置顶，避免和普通单行穿插。
 */
const displayRows = computed((): DisplayRow[] => {
  const list = filteredRecords.value
  const zone = zoneName.value
  const groups: DisplayRow[] = []
  const singles: DisplayRow[] = []
  let i = 0
  while (i < list.length) {
    const rec = list[i]
    const hk = recordHostKey(rec, zone)
    let j = i + 1
    while (j < list.length && recordHostKey(list[j], zone) === hk) j++
    const chunk = list.slice(i, j)
    if (shouldCollapseHostGroup(chunk, zone)) {
      groups.push({
        kind: 'group',
        hostKey: hk,
        label: hostGroupLabel(hk, zone),
        records: chunk,
        key: `g:${hk}`,
      })
    } else {
      for (const r of chunk) {
        singles.push({
          kind: 'single',
          record: r,
          key: `r:${String(r.id || `${r.name}-${r.type}-${r.value}-${r.line}`)}`,
        })
      }
    }
    i = j
  }
  return [...groups, ...singles]
})

/** 折叠状态：默认收起；搜索命中自动展开 */
const expandedHosts = ref<Record<string, boolean>>({})

function isHostExpanded(hostKey: string) {
  return expandedHosts.value[hostKey] === true
}

function toggleHost(hostKey: string) {
  expandedHosts.value = {
    ...expandedHosts.value,
    [hostKey]: !isHostExpanded(hostKey),
  }
}

function groupPurposeLabels(groupRecords: DnsRecord[]) {
  return orderedPurposeLabels(groupRecords, zoneName.value)
}

function recordMatchesKeyword(record: DnsRecord, q: string) {
  if (!q) return false
  const blob = [
    record.name,
    record.type,
    record.value,
    record.content,
    record.remark,
    record.comment,
    record.line,
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ')
  return blob.includes(q)
}

watch(
  [() => keyword.value, displayRows],
  () => {
    const q = keyword.value.trim().toLowerCase()
    if (!q) return
    const next = { ...expandedHosts.value }
    let changed = false
    for (const row of displayRows.value) {
      if (row.kind !== 'group') continue
      if (row.records.some((r) => recordMatchesKeyword(r, q)) || row.label.toLowerCase().includes(q)) {
        if (!next[row.hostKey]) {
          next[row.hostKey] = true
          changed = true
        }
      }
    }
    if (changed) expandedHosts.value = next
  },
  { flush: 'post' },
)

function groupAllSelected(groupRecords: DnsRecord[]) {
  return groupRecords.length > 0 && groupRecords.every((r) => selection.isSelected(r))
}

function groupSomeSelected(groupRecords: DnsRecord[]) {
  const n = groupRecords.filter((r) => selection.isSelected(r)).length
  return n > 0 && n < groupRecords.length
}

function toggleGroupSelect(groupRecords: DnsRecord[]) {
  const all = groupAllSelected(groupRecords)
  for (const r of groupRecords) selection.toggle(r, !all)
}

function recordRowKey(record: DnsRecord) {
  return String(record.id || `${record.name || ''}·${record.type || ''}·${record.value || ''}·${record.line || ''}`)
}

const selection = useRowSelection(filteredRecords, (row) =>
  String(row.id || `${row.name}-${row.type}-${row.value || ''}-${row.line || ''}`),
)
const selectedCount = computed(() => selection.selected.value.length)

async function ensureProvider() {
  if (!getCachedProvider(props.providerId)) await loadProviders({ refresh: true })
  if (!getCachedProvider(props.providerId)) {
    toast.warning('服务商不可用')
    router.replace('/')
  }
}

async function load(options: { refresh?: boolean } = {}) {
  await withMinLoading(loading, async () => {
    try {
      const response = await dnsApi.records(props.providerId, props.zoneId, {
        page: page.value,
        per_page: pageSize.value,
        keyword: keyword.value,
        // Type filter is client-side only so chips stay fixed and complete.
        refresh: options.refresh,
      })
      records.value = response.data || []
      const meta = (response as any).meta || {}
      // API total must win; never fall back to current page length when total present as 0-ish wrongly
      const rawTotal = meta.total ?? meta.count
      total.value = Number(rawTotal != null && rawTotal !== '' ? rawTotal : records.value.length || 0)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
}

async function onRefresh() {
  refreshing.value = true
  try {
      await handleRefresh(loading, load, toast.success)
  } finally {
    refreshing.value = false
  }
}

function onPageChange(next: number) {
  page.value = next
  selection.clear()
  expandedHosts.value = {}
  void load()
}

function onPageSizeChange(next: number) {
  pageSize.value = next
  savePageSize('dns-records', next)
  page.value = 1
  selection.clear()
  expandedHosts.value = {}
  void load()
}

function onSearch() {
  page.value = 1
  selection.clear()
  expandedHosts.value = {}
  void load()
}

function setTypeFilter(next: string) {
  typeFilter.value = next
  selection.clear()
  // client-side type filter only — no page reset needed for server page
}

/** Cloudflare ttl=1 表示自动 */
function ttlDisplay(ttl?: number | string | null) {
  if (ttl === 1 || ttl === '1') return '自动'
  if (ttl == null || ttl === '') return '-'
  return String(ttl)
}

function openCreate() {
  editing.value = null
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
  const names = parseRecordNames(form.name)
  const value = form.value.trim()
  if (!names.length) {
    toast.warning('主机记录不能为空')
    return
  }
  if (!value) {
    toast.warning('记录值不能为空')
    return
  }
  if (editing.value && names.length !== 1) {
    toast.warning('编辑时只能填写一个主机记录')
    return
  }

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
    } else if (names.length === 1) {
      await dnsApi.createRecord(
        props.providerId,
        props.zoneId,
        { ...base, name: names[0] },
        { zoneName: zoneName.value },
      )
      toast.success('记录已创建')
    } else {
      const created = await dnsApi.batchCreateRecords(props.providerId, props.zoneId, {
        zone_name: zoneName.value,
        records: names.map((name) => ({ ...base, name })),
      })
      const jobId = String((created.data as { id?: string } | undefined)?.id || '')
      if (!jobId) {
        toast.success(`已提交批量创建（${names.length} 条）`)
      } else {
        const poll = () =>
          jobProgress.pollJob(jobId, {
            label: '批量创建',
            fetchJob: async (id) => ((await dnsApi.batchJob(props.providerId, id)).data as any) || {},
          })
        const job = await poll()
        const failed = jobProgress.failedItems(job).map((item) => formatFailedJobItem(item))
        if (failed.length) {
          await showBatchFailures(job?.message || '批量创建完成', failed, '条', {
            onRetry: async () => {
              await dnsApi.batchRetry(props.providerId, jobId)
              return poll()
            },
          })
        } else {
          toast.success(job?.message || `批量创建完成（${names.length} 条）`)
        }
      }
    }
    dialogOpen.value = false
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function removeRecord(record: DnsRecord) {
  if (!(await confirmDelete(`${record.name} · ${record.type}`))) return
  try {
    await dnsApi.deleteRecord(props.providerId, props.zoneId, String(record.id || ''))
    toast.success('已删除')
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  }
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
  const created = await create()
  const jobId = String((created.data as { id?: string } | null | undefined)?.id || '')
  if (!jobId) throw new Error(`${label}任务创建失败`)

  const poll = () =>
    jobProgress.pollJob(jobId, {
      label,
      fetchJob: async (id) => ((await dnsApi.batchJob(props.providerId, id)).data as any) || {},
    })

  const job = await poll()
  const failed = jobProgress.failedItems(job).map((item) => formatFailedJobItem(item))
  if (failed.length) {
    await showBatchFailures(job?.message || `${label}完成`, failed, '条', {
      onRetry: async () => {
        await dnsApi.batchRetry(props.providerId, jobId)
        return poll()
      },
    })
  } else {
    toast.success(job?.message || `${label}完成`)
  }
  selection.clear()
  await load({ refresh: true })
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
  if (!Object.keys(patch).length) {
    toast.warning('请至少填写一项要修改的字段')
    return
  }
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
  try {
    batchEditOpen.value = false
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
  }
}

async function resumeJobs() {
  if (jobProgress.running.value) return
  const finished = await jobProgress.resumeActive(
    () => dnsApi.batchActive(props.providerId, props.zoneId),
    {
      label: 'DNS 批量',
      fetchJob: async (id) => ((await dnsApi.batchJob(props.providerId, id)).data as any) || {},
    },
  )
  if (finished) {
    const failed = jobProgress.failedItems(finished)
    if (failed.length) {
      showBatchFailures(finished.message || 'DNS 批量完成', failed.map((i) => formatFailedJobItem(i)), '条')
    }
    await load({ refresh: true })
  }
}

watch(
  () => [props.providerId, props.zoneId],
  async () => {
    selection.clear()
    await ensureProvider()
    await load()
    await resumeJobs()
  },
)

onMounted(async () => {
  await ensureProvider()
  await load()
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

    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model="keyword"
          class="h-8 w-full sm:w-72"
          placeholder="搜索主机 / 记录值"
          @keyup.enter="onSearch()"
        />
        <Button variant="outline" size="sm" :loading="loading" @click="onSearch()">
          <Search class="size-4" />
          搜索
        </Button>
        <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
          <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
          刷新
        </Button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          :variant="typeFilter === 'all' ? 'default' : 'outline'"
          @click="setTypeFilter('all')"
        >
          全部
        </Button>
        <Button
          v-for="item in typeOptions"
          :key="item"
          size="sm"
          :variant="typeFilter === item ? 'default' : 'outline'"
          @click="setTypeFilter(item)"
        >
          {{ item }}
        </Button>
      </div>
    </div>

    <TableLoading :loading="loading" :empty="!filteredRecords.length">
      <Table>
        <TableHeader class="bg-muted/50">
          <TableRow class="!border-0">
            <TableHead class="w-10 rounded-l-lg px-3">
              <button
                type="button"
                class="border-input text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs outline-none transition-colors"
                :class="selection.headerChecked.value ? 'bg-primary border-primary' : 'bg-transparent'"
                @click="selection.toggleAll()"
              >
                <svg v-if="selection.headerChecked.value === true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="size-3"><path d="M20 6 9 17l-5-5"/></svg>
                <svg v-else-if="selection.headerChecked.value === 'indeterminate'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="size-3"><path d="M5 12h14"/></svg>
              </button>
            </TableHead>
            <TableHead class="w-[7rem] max-w-[7rem]">主机</TableHead>
            <TableHead class="w-[5.5rem]">类型</TableHead>
            <TableHead class="w-[14rem] max-w-[18rem]">记录值</TableHead>
            <TableHead class="w-[5rem]">TTL</TableHead>
            <TableHead class="w-[6rem]">线路</TableHead>
            <TableHead class="min-w-[6rem] max-w-[10rem]">备注</TableHead>
            <TableHead class="w-12 rounded-r-lg" />
          </TableRow>
        </TableHeader>
        <TableBody class="**:data-[slot=table-cell]:py-2.5">
          <TableRow v-if="!filteredRecords.length && !loading">
            <TableCell colspan="8" class="text-muted-foreground py-10 text-center">暂无记录</TableCell>
          </TableRow>

          <template v-for="row in displayRows" :key="row.key">
            <!-- 可折叠组头：默认回源 / 优选 / DCV 同主机 -->
            <TableRow v-if="row.kind === 'group'" class="bg-muted/30 hover:bg-muted/40">
              <TableCell class="px-3">
                <Checkbox
                  :model-value="
                    groupAllSelected(row.records)
                      ? true
                      : groupSomeSelected(row.records)
                        ? 'indeterminate'
                        : false
                  "
                  @update:model-value="() => toggleGroupSelect(row.records)"
                  @click.stop
                />
              </TableCell>
              <TableCell colspan="6" class="px-2">
                <button
                  type="button"
                  class="flex w-full min-w-0 items-center gap-2 text-left"
                  @click="toggleHost(row.hostKey)"
                >
                  <ChevronDown v-if="isHostExpanded(row.hostKey)" class="text-muted-foreground size-4 shrink-0" />
                  <ChevronRight v-else class="text-muted-foreground size-4 shrink-0" />
                  <span class="min-w-0 truncate font-medium">{{ row.label }}</span>
                  <span class="text-muted-foreground shrink-0 text-xs">{{ row.records.length }} 条</span>
                  <span class="flex min-w-0 flex-wrap items-center gap-1">
                    <Badge
                      v-for="label in groupPurposeLabels(row.records)"
                      :key="label"
                      variant="outline"
                      class="text-[11px] font-normal"
                    >
                      {{ label }}
                    </Badge>
                  </span>
                </button>
              </TableCell>
              <TableCell class="w-12" />
            </TableRow>

            <!-- 组内子行（展开时） -->
            <TableRow
              v-for="record in row.kind === 'group' && isHostExpanded(row.hostKey) ? row.records : []"
              :key="recordRowKey(record)"
              class="bg-muted/10"
            >
              <TableCell class="px-3">
                <Checkbox
                  :model-value="selection.isSelected(record)"
                  @update:model-value="(v: boolean | 'indeterminate') => selection.toggle(record, v === true)"
                  @click.stop
                />
              </TableCell>
              <TableCell class="max-w-[7rem] truncate font-medium pl-8" :title="String(record.name || '@')">
                {{ record.name || '@' }}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{{ record.type }}</Badge>
              </TableCell>
              <TableCell class="w-[14rem] max-w-[18rem]">
                <div class="flex min-w-0 items-center gap-1">
                  <div class="min-w-0 flex-1 truncate" :title="String(record.value || record.content || '')">
                    {{ record.value || record.content || '-' }}
                  </div>
                  <Button
                    v-if="record.value || record.content"
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0"
                    title="复制记录值"
                    @click.stop="copyRecordValue(record)"
                  >
                    <Copy class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
              <TableCell>{{ ttlDisplay(record.ttl) }}</TableCell>
              <TableCell>
                <template v-if="isCloudflare">
                  <Badge :variant="record.proxied ? 'default' : 'outline'">
                    {{ record.proxied ? '代理' : '仅 DNS' }}
                  </Badge>
                </template>
                <template v-else>{{ record.line || '默认' }}</template>
              </TableCell>
              <TableCell>
                <div
                  class="text-muted-foreground max-w-[10rem] truncate text-sm"
                  :title="String(record.remark || record.comment || '')"
                >
                  {{ record.remark || record.comment || '—' }}
                </div>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8">
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @click="openEdit(record)">编辑</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" @click="removeRecord(record)">删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>

            <!-- 普通单行 -->
            <TableRow v-if="row.kind === 'single'">
              <TableCell class="px-3">
                <Checkbox
                  :model-value="selection.isSelected(row.record)"
                  @update:model-value="(v: boolean | 'indeterminate') => selection.toggle(row.record, v === true)"
                  @click.stop
                />
              </TableCell>
              <TableCell class="max-w-[7rem] truncate font-medium" :title="String(row.record.name || '@')">
                {{ row.record.name || '@' }}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{{ row.record.type }}</Badge>
              </TableCell>
              <TableCell class="w-[14rem] max-w-[18rem]">
                <div class="flex min-w-0 items-center gap-1">
                  <div class="min-w-0 flex-1 truncate" :title="String(row.record.value || row.record.content || '')">
                    {{ row.record.value || row.record.content || '-' }}
                  </div>
                  <Button
                    v-if="row.record.value || row.record.content"
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="size-7 shrink-0"
                    title="复制记录值"
                    @click.stop="copyRecordValue(row.record)"
                  >
                    <Copy class="size-3.5" />
                  </Button>
                </div>
              </TableCell>
              <TableCell>{{ ttlDisplay(row.record.ttl) }}</TableCell>
              <TableCell>
                <template v-if="isCloudflare">
                  <Badge :variant="row.record.proxied ? 'default' : 'outline'">
                    {{ row.record.proxied ? '代理' : '仅 DNS' }}
                  </Badge>
                </template>
                <template v-else>{{ row.record.line || '默认' }}</template>
              </TableCell>
              <TableCell>
                <div
                  class="text-muted-foreground max-w-[10rem] truncate text-sm"
                  :title="String(row.record.remark || row.record.comment || '')"
                >
                  {{ row.record.remark || row.record.comment || '—' }}
                </div>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8">
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @click="openEdit(row.record)">编辑</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" @click="removeRecord(row.record)">删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </TableLoading>

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
      v-if="selectedCount"
      class="pointer-events-none sticky bottom-4 z-20 flex justify-center px-2"
    >
      <div
        class="bg-card pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border px-3 py-2 shadow-md"
      >
        <span class="text-muted-foreground px-1 text-sm whitespace-nowrap">
          已选 {{ selectedCount }}
        </span>
        <Button size="sm" :disabled="jobProgress.running.value" @click="openBatchEdit">
          批量管理
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="text-destructive"
          :disabled="jobProgress.running.value"
          @click="batchDeleteSelected"
        >
          批量删除
        </Button>
        <Button size="sm" variant="ghost" @click="selection.clear()">取消</Button>
      </div>
    </div>

    <AppDialog
      v-model:open="dialogOpen"
      :title="editing ? '编辑解析记录' : '添加解析记录'"
      description="新增时主机记录可用英文/中文逗号批量填写，例如 www,api"
    >
      <FieldGroup>
        <Field>
          <FieldLabel>主机记录</FieldLabel>
          <Input v-model="form.name" placeholder="例如：www 或 www,ggg；根记录填 @" />
        </Field>
        <div :class="isCloudflare ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'">
          <Field>
            <FieldLabel>类型</FieldLabel>
            <Select v-model="form.type">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="item in typeOptions" :key="item" :value="item">{{ item }}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <!-- Cloudflare 默认自动 TTL(1)，添加/编辑不展示 -->
          <Field v-if="!isCloudflare">
            <FieldLabel>TTL</FieldLabel>
            <Input v-model="form.ttl" />
          </Field>
        </div>
        <Field>
          <FieldLabel>记录值</FieldLabel>
          <Input v-model="form.value" placeholder="IP / 域名 / 文本" />
        </Field>
        <Field v-if="!isCloudflare">
          <FieldLabel>线路</FieldLabel>
          <Select v-model="form.line">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="选择线路" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="item in dnspodLineOptions"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field v-if="form.type === 'MX'">
          <FieldLabel>MX 优先级</FieldLabel>
          <Input v-model="form.priority" type="number" min="0" max="65535" placeholder="10" />
        </Field>
        <Field v-if="isCloudflare" orientation="horizontal">
          <Checkbox id="proxied" v-model="form.proxied" />
          <FieldLabel for="proxied">启用代理</FieldLabel>
        </Field>
        <Field>
          <FieldLabel>备注</FieldLabel>
          <Input v-model="form.remark" placeholder="可选" />
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="dialogOpen = false">取消</Button>
        <Button :loading="saving" @click="save">保存</Button>
      </template>
    </AppDialog>

    <AppDialog
      v-model:open="batchEditOpen"
      title="批量修改记录"
      :description="`仅填写需要改的字段，将应用到已选 ${selectedCount} 条记录。`"
    >
      <FieldGroup>
        <Field>
          <FieldLabel>记录值</FieldLabel>
          <Input v-model="batchPatch.value" placeholder="留空不改" />
        </Field>
        <div :class="isCloudflare ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'">
          <Field v-if="!isCloudflare">
            <FieldLabel>TTL</FieldLabel>
            <Input v-model="batchPatch.ttl" placeholder="留空不改" />
          </Field>
          <Field v-if="!isCloudflare">
            <FieldLabel>线路</FieldLabel>
            <Select v-model="batchPatch.line">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="留空不改" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__keep">不改</SelectItem>
                <SelectItem
                  v-for="item in dnspodLineOptions"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel>备注</FieldLabel>
          <Input v-model="batchPatch.remark" placeholder="留空不改" />
        </Field>
        <Field v-if="isCloudflare">
          <FieldLabel>代理</FieldLabel>
<Select v-model="batchPatch.proxied">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="代理设置" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__keep">不改</SelectItem>
              <SelectItem value="true">开启代理</SelectItem>
              <SelectItem value="false">仅 DNS</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>MX 优先级</FieldLabel>
          <Input v-model="batchPatch.priority" placeholder="留空不改" />
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="batchEditOpen = false">取消</Button>
        <Button @click="batchUpdateSelected">开始修改</Button>
      </template>
    </AppDialog>
  </div>
</template>
