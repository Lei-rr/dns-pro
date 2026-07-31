<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { EllipsisVertical, Plus, RefreshCw, Search } from '@lucide/vue'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow, TableLoading } from '@/shared/ui/table'
import { edgeOneApi } from '@/features/edgeone/api/edgeone'
import { edgeOneStatusLabel } from '@/features/edgeone/lib/status'
import { providerPath } from '@/features/providers/lib/paths'
import type { EdgeOneAccelerationDomain, EdgeOneZone } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { dnsSideEffectFromData } from '@/shared/lib/dns-side-effects'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { useRowBusy, removeListItem, patchListItem } from '@/shared/lib/row-busy'
import { Spinner } from '@/shared/ui/spinner'
import EdgeOneDomainForm from '@/features/edgeone/components/EdgeOneDomainForm.vue'
import CertificateForm from '@/features/edgeone/components/CertificateForm.vue'
import { JobProgressAlert } from '@/shared/ui/job-progress'
import { useJobProgress } from '@/shared/lib/job-progress'
import { formatFailedJobItem, showBatchFailures } from '@/shared/lib/batch'
import { runProviderBatch } from '@/shared/lib/run-provider-batch'
import type { JobLike } from '@/shared/lib/job-progress'
import { useRowSelection } from '@/shared/lib/row-selection'
import { Checkbox, SelectAllCheckbox } from '@/shared/ui/checkbox'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'

const props = defineProps<{ providerId: string; zoneId: string }>()
const router = useRouter()
const jobProgress = useJobProgress()
const { isBusy: isRowBusy, runBusy } = useRowBusy()

const saving = ref(false)
const domains = ref<EdgeOneAccelerationDomain[]>([])
const zoneMeta = ref<EdgeOneZone | null>(null)
const keyword = ref('')
const dialogOpen = ref(false)
const certDialogOpen = ref(false)
const editingDomain = ref<EdgeOneAccelerationDomain | null>(null)
const formErrors = ref<FieldErrors>({})
const certErrors = ref<FieldErrors>({})

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return domains.value
  return domains.value.filter((item) => {
    const name = String(item.domain_name || item.name || '').toLowerCase()
    const cname = String(item.cname || '').toLowerCase()
    return name.includes(q) || cname.includes(q)
  })
})
const pageTitle = computed(() => zoneMeta.value?.name || decodeURIComponent(props.zoneId))

const { loading, refreshing, pageSize, runLoad, onRefresh, onPageSizeChange: setPageSize, fail } = useListPage({
  pageSizeScope: 'edgeone-records',
  load: async (options = {}) => {
    try {
      if (options.refresh || !zoneMeta.value) {
        const meta = await loadZoneMeta(options.refresh)
        if (options.isLatest && !options.isLatest()) return false
        zoneMeta.value = meta
      }
      const response = await edgeOneApi.accelerationDomains(props.providerId, props.zoneId, {
        refresh: options.refresh,
      })
      if (options.isLatest && !options.isLatest()) return false
      domains.value = response.data || []
    } catch (error) {
      if (!options.isLatest || options.isLatest()) fail(error)
      return false
    }
  },
})
const { page, total, pagedItems: pagedDomains, resetPage } = useLocalPagination(filtered, pageSize)
const selection = useRowSelection(pagedDomains, (row) => String(row.domain_name || row.name || ''))
const selectedCount = computed(() => selection.selected.value.length)
watch(keyword, () => {
  resetPage()
  selection.clear()
})

function onPageChange(next: number) {
  page.value = next
  selection.clear()
}

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
  selection.clear()
}

function domainName(record: EdgeOneAccelerationDomain) {
  return String(record.domain_name || record.name || '')
}

async function loadZoneMeta(refresh = false): Promise<EdgeOneZone | null> {
  try {
    // Prefer list match so we get name without extra endpoint failures
    const response = await edgeOneApi.zones(props.providerId, { refresh })
    const list = response.data || []
    const matched =
      list.find((z) => String(z.id) === props.zoneId || String(z.name) === props.zoneId) || null
    if (matched) return matched
    try {
      const one = await edgeOneApi.zone(props.providerId, props.zoneId, { refresh })
      return one.data || null
    } catch {
      return null
    }
  } catch {
    return null
  }
}

function openCreate() {
  editingDomain.value = null
  formErrors.value = {}
  dialogOpen.value = true
}

function openEdit(record: EdgeOneAccelerationDomain) {
  editingDomain.value = record
  formErrors.value = {}
  dialogOpen.value = true
}

function openCert(record: EdgeOneAccelerationDomain) {
  editingDomain.value = record
  certErrors.value = {}
  certDialogOpen.value = true
}

async function save(payload: Record<string, unknown>) {
  saving.value = true
  try {
    const data: Record<string, unknown> = {
      origin_type: payload.origin_type as string,
      origin: payload.origin as string,
    }
    if (!editingDomain.value) data.domain_name = payload.fullDomain as string
    if (payload.origin_protocol) data.origin_protocol = payload.origin_protocol
    if (payload.http_origin_port) data.http_origin_port = payload.http_origin_port
    if (payload.https_origin_port) data.https_origin_port = payload.https_origin_port
    if (payload.ipv6_status) data.ipv6_status = payload.ipv6_status
    if (payload.host_header) data.host_header = payload.host_header

    if (editingDomain.value) {
      const response = await edgeOneApi.updateAccelerationDomain(
        props.providerId,
        props.zoneId,
        domainName(editingDomain.value),
        data,
      )
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '加速域名已更新')
    } else {
      const response = await edgeOneApi.createAccelerationDomain(props.providerId, props.zoneId, data, {
        autoSync: !!payload.autoSync,
      })
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '加速域名已创建')
    }
    dialogOpen.value = false
    saving.value = false
    await runLoad()
  } catch (error) {
    formErrors.value = { ...formErrors.value, ...serverFieldErrors(error) }
    toast.error(errorMessage(error))
    saving.value = false
  }
}

async function saveCertificate(payload: Record<string, unknown>) {
  if (!editingDomain.value) return
  saving.value = true
  try {
    await edgeOneApi.updateCertificate(props.providerId, props.zoneId, domainName(editingDomain.value), payload)
    toast.success('证书已更新')
    certDialogOpen.value = false
    saving.value = false
    await runLoad()
  } catch (error) {
    certErrors.value = { ...certErrors.value, ...serverFieldErrors(error) }
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function setStatus(record: EdgeOneAccelerationDomain, status: string) {
  const key = domainName(record)
  await runBusy(key, async () => {
    try {
      await edgeOneApi.updateAccelerationDomainStatus(props.providerId, props.zoneId, key, status)
      patchListItem(domains, (item) => domainName(item) === key, {
        ...record,
        status,
        active_status: status,
      })
      toast.success('状态已更新')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
}

async function syncCname(record: EdgeOneAccelerationDomain) {
  const key = domainName(record)
  await runBusy(key, async () => {
    try {
      const response = await edgeOneApi.syncAccelerationDomainCname(props.providerId, props.zoneId, key)
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), 'CNAME 已同步')
      // CNAME 值可能变化，轻量整表刷新但不挡其它行操作过久：仍 silent 局部优先整表
      await runLoad()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
}

async function removeDomain(record: EdgeOneAccelerationDomain) {
  const name = domainName(record)
  if (!(await confirmDelete(name))) return
  await runBusy(name, async () => {
    try {
      const response = await edgeOneApi.deleteAccelerationDomain(props.providerId, props.zoneId, name)
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'cleanup'), '已删除')
      removeListItem(domains, (item) => domainName(item) === name)
      selection.clear()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
}

async function runEdgeBatch(
  create: () => Promise<{ data?: unknown }>,
  label: string,
) {
  await runProviderBatch({
    label,
    create,
    fetchJob: async (id) => ((await edgeOneApi.batchJob(props.providerId, id)).data as Record<string, unknown>) || {},
    retry: (id) => edgeOneApi.batchRetry(props.providerId, id),
    clearSelection: () => selection.clear(),
    onDone: () => runLoad(),
    failureUnit: '个',
    jobProgress,
  })
}

async function batchDisableSelected() {
  const list = selection.selected.value
  if (!list.length) {
    toast.warning('请先勾选加速域名')
    return
  }
  if (!(await confirmDialog({ title: '批量停用', description: `确认停用已选 ${list.length} 个加速域名？`, confirmText: '停用', destructive: true }))) return
  try {
    await runEdgeBatch(
      () => edgeOneApi.batchDisable(props.providerId, props.zoneId, { domains: list }),
      '批量停用',
    )
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function batchDeleteSelected() {
  const list = selection.selected.value
  if (!list.length) {
    toast.warning('请先勾选加速域名')
    return
  }
  if (!(await confirmDialog({ title: '批量删除', description: `确认删除已选 ${list.length} 个加速域名？`, confirmText: '删除', destructive: true }))) return
  try {
    await runEdgeBatch(
      () => edgeOneApi.batchDelete(props.providerId, props.zoneId, { domains: list }),
      '批量删除',
    )
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function resumeJobs() {
  if (jobProgress.running.value) return
  const finished = await jobProgress.resumeActive(
    () => edgeOneApi.batchActive(props.providerId, props.zoneId),
    {
      label: 'EdgeOne 批量',
      fetchJob: async (id) => ((await edgeOneApi.batchJob(props.providerId, id)).data as JobLike) || {},
    },
  )
  if (finished) {
    const failed = jobProgress.failedItems(finished)
    if (failed.length) {
      showBatchFailures(finished.message || 'EdgeOne 批量完成', failed.map((i) => formatFailedJobItem(i)), '个')
    }
    await runLoad()
  }
}

watch(
  () => [props.providerId, props.zoneId],
  () => {
    selection.clear()
    zoneMeta.value = null
    void runLoad().then(() => resumeJobs()).catch(fail)
  },
)

onMounted(() => {
  void runLoad().then(() => resumeJobs()).catch(fail)
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="pageTitle" description="EdgeOne 加速域名">
      <Button variant="outline" size="sm" @click="router.push(providerPath(providerId))">返回站点</Button>
      <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
        <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
        刷新
      </Button>
      <Button size="sm" @click="openCreate">
        <Plus class="size-4" />
        添加域名
      </Button>
    </PageHeader>

    <JobProgressAlert
      :running="jobProgress.running.value"
      :text="jobProgress.text.value"
      title="EdgeOne 批量任务"
      :status="jobProgress.job.value?.status"
      :percent="jobProgress.percent.value"
    />

    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model="keyword"
          class="h-8 w-full sm:w-72"
          placeholder="搜索加速域名 / CNAME"
          @keyup.enter="resetPage()"
        />
        <Button variant="outline" size="sm" @click="resetPage()">
          <Search class="size-4" />
          搜索
        </Button>
        <template v-if="selectedCount && !jobProgress.running.value">
          <span class="text-muted-foreground text-sm">已选 {{ selectedCount }}</span>
          <Button variant="outline" size="sm" :disabled="jobProgress.running.value" @click="batchDisableSelected">
            批量停用
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="text-destructive"
            :disabled="jobProgress.running.value"
            @click="batchDeleteSelected"
          >
            批量删除
          </Button>
        </template>
      </div>

      <TableLoading :loading="loading" :empty="!filtered.length">
        <Table>
          <TableHeader class="bg-muted/50">
            <TableRow class="!border-0">
              <TableHead class="w-10 rounded-l-lg px-3">
              <SelectAllCheckbox
                :checked="selection.headerChecked.value"
                aria-label="全选当前列表"
                @click="selection.toggleAll()"
              />
              </TableHead>
              <TableHead>加速域名</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>CNAME</TableHead>
              <TableHead>源站</TableHead>
              <TableHead class="rounded-r-lg w-12" />
            </TableRow>
          </TableHeader>
          <TableBody class="**:data-[slot=table-cell]:py-2.5">
            <TableRow v-if="!filtered.length && !loading">
              <TableCell colspan="6" class="text-muted-foreground py-10 text-center">暂无加速域名</TableCell>
            </TableRow>
            <TableRow
              v-for="record in pagedDomains"
              :key="domainName(record)"
              :class="isRowBusy(domainName(record)) && 'bg-muted/40 opacity-80'"
            >
              <TableCell class="px-3">
                <Checkbox
                  :model-value="selection.isSelected(record)"
                  @update:model-value="(v: boolean | 'indeterminate') => selection.toggle(record, v === true)"
                @click.stop
                />
              </TableCell>
              <TableCell class="font-medium">{{ domainName(record) }}</TableCell>
              <TableCell>
                <Badge variant="secondary">{{ edgeOneStatusLabel(record.status) }}</Badge>
              </TableCell>
              <TableCell class="max-w-[220px] truncate">{{ record.cname || '-' }}</TableCell>
              <TableCell class="max-w-[180px] truncate">
                {{ record.origin?.value || record.origin_type || '-' }}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :disabled="isRowBusy(domainName(record))"
                    >
                      <Spinner v-if="isRowBusy(domainName(record))" class="size-4" />
                      <EllipsisVertical v-else class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      :disabled="isRowBusy(domainName(record))"
                      @click="syncCname(record)"
                    >
                      同步 CNAME
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="openEdit(record)">编辑</DropdownMenuItem>
                    <DropdownMenuItem @click="openCert(record)">HTTPS 配置</DropdownMenuItem>
                    <DropdownMenuItem @click="setStatus(record, 'online')">启用</DropdownMenuItem>
                    <DropdownMenuItem @click="setStatus(record, 'offline')">停用</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" @click="removeDomain(record)">删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
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
    </div>

    <EdgeOneDomainForm
      v-model:open="dialogOpen"
      :zone-name="pageTitle"
      :editing="!!editingDomain"
      :domain="editingDomain"
      :errors="formErrors"
      @save="save"
    />
    <CertificateForm
      v-model:open="certDialogOpen"
      :certificate="editingDomain?.certificate"
      :errors="certErrors"
      @save="saveCertificate"
    />
  </div>
</template>
