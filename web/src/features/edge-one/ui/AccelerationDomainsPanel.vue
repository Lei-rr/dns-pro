<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, RefreshCw, Search, X } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button, LoadingButton } from '@/shared/ui/button'
import { FloatingSelectionBar } from '@/shared/ui/floating-selection-bar'
import { Input } from '@/shared/ui/input'
import { edgeOneApi } from '@/features/edge-one/api/edge-one-api'

import type { EdgeOneAccelerationDomain, EdgeOneZone } from '@/features/edge-one/model/types'
import { toast } from '@/shared/lib/toast'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { dnsSideEffectFromData } from '@/shared/lib/dns-side-effects'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { useRowBusy, removeListItem, patchListItem } from '@/shared/lib/row-busy'
import EdgeOneDomainForm from '@/features/edge-one/ui/AccelerationDomainFormDialog.vue'
import CertificateForm from '@/features/edge-one/ui/CertificateFormDialog.vue'
import AccelerationDomainsTable from '@/features/edge-one/ui/AccelerationDomainsTable.vue'
import { formatFailedJobItem, JobProgressAlert, runBatchJob, showBatchFailures, useJobProgress } from '@/shared/job'
import type { JobLike } from '@/shared/job'
import { selectedAvailableRows, useRowSelection } from '@/shared/lib/row-selection'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'
import { encodePath } from '@/shared/lib/path'
import { createScopeGeneration, type ScopeOwner } from '@/shared/lib/scope-generation'

const props = defineProps<{ providerId: string; zoneId: string; dnspodLinked: boolean }>()
const mutationGeneration = createScopeGeneration()

type EdgeOneScope = { providerId: string; zoneId: string }

function captureMutationOwner(): ScopeOwner<EdgeOneScope> {
  return mutationGeneration.capture({ providerId: props.providerId, zoneId: props.zoneId })
}
const router = useRouter()
const jobProgress = useJobProgress()
const { isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()

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

const {
  loading,
  refreshing,
  pageSize,
  runLoad,
  onRefresh,
  onPageSizeChange: setPageSize,
  active: listActive,
  fail,
} = useListPage({
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
      return true
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

function clearSearch() {
  keyword.value = ''
  resetPage()
}

function domainName(record: EdgeOneAccelerationDomain) {
  return String(record.domain_name || record.name || '')
}

async function loadZoneMeta(refresh = false): Promise<EdgeOneZone | null> {
  try {
    // Prefer list match so we get name without extra endpoint failures
    const response = await edgeOneApi.zones(props.providerId, { refresh })
    const list = response.data || []
    const matched = list.find((z) => String(z.id) === props.zoneId || String(z.name) === props.zoneId) || null
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
  if (saving.value) return
  const owner = mutationGeneration.claim({ providerId: props.providerId, zoneId: props.zoneId })
  const editingName = editingDomain.value ? domainName(editingDomain.value) : ''
  saving.value = true
  try {
    const data: Record<string, unknown> = {
      origin_type: payload.origin_type as string,
      origin: payload.origin as string,
    }
    if (!editingName) data.domain_name = payload.fullDomain as string
    if (payload.origin_protocol) data.origin_protocol = payload.origin_protocol
    if (payload.http_origin_port) data.http_origin_port = payload.http_origin_port
    if (payload.https_origin_port) data.https_origin_port = payload.https_origin_port
    if (payload.ipv6_status) data.ipv6_status = payload.ipv6_status
    if (payload.host_header) data.host_header = payload.host_header

    if (editingName) {
      const response = await edgeOneApi.updateAccelerationDomain(
        owner.value.providerId,
        owner.value.zoneId,
        editingName,
        data
      )
      if (!owner.active()) return
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '加速域名已更新')
    } else {
      const response = await edgeOneApi.createAccelerationDomain(owner.value.providerId, owner.value.zoneId, data, {
        autoSync: !!payload.autoSync,
      })
      if (!owner.active()) return
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '加速域名已创建')
    }
    if (!owner.active()) return
    dialogOpen.value = false
    await runLoad()
  } catch (error) {
    if (!owner.active()) return
    formErrors.value = { ...formErrors.value, ...serverFieldErrors(error) }
    toast.error(errorMessage(error))
  } finally {
    if (owner.active()) saving.value = false
  }
}

async function saveCertificate(payload: Record<string, unknown>) {
  if (!editingDomain.value || saving.value) return
  const owner = mutationGeneration.claim({ providerId: props.providerId, zoneId: props.zoneId })
  const editingName = domainName(editingDomain.value)
  saving.value = true
  try {
    await edgeOneApi.updateCertificate(owner.value.providerId, owner.value.zoneId, editingName, payload)
    if (!owner.active()) return
    toast.success('证书已更新')
    certDialogOpen.value = false
    await runLoad()
  } catch (error) {
    if (!owner.active()) return
    certErrors.value = { ...certErrors.value, ...serverFieldErrors(error) }
    toast.error(errorMessage(error))
  } finally {
    if (owner.active()) saving.value = false
  }
}

async function setStatus(record: EdgeOneAccelerationDomain, status: string) {
  const key = domainName(record)
  await runBusy(key, async (owner) => {
    try {
      await edgeOneApi.updateAccelerationDomainStatus(props.providerId, props.zoneId, key, status)
      if (!owner.active()) return
      patchListItem(
        domains,
        (item) => domainName(item) === key,
        (item) => ({
          ...item,
          status,
          active_status: status,
        })
      )
      toast.success('状态已更新')
    } catch (error) {
      if (owner.active()) toast.error(errorMessage(error))
    }
  })
}

async function repairDomainDns(record: EdgeOneAccelerationDomain) {
  const key = domainName(record)
  await runBusy(key, async (owner) => {
    try {
      const response = await edgeOneApi.repairAccelerationDomainDns(props.providerId, props.zoneId, key)
      if (!owner.active()) return
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '域名解析已修复')
      // CNAME 值可能变化，轻量整表刷新但不挡其它行操作过久：仍 silent 局部优先整表
      await runLoad()
    } catch (error) {
      if (owner.active()) toast.error(errorMessage(error))
    }
  })
}

async function removeDomain(record: EdgeOneAccelerationDomain) {
  const scopeOwner = captureMutationOwner()
  const providerId = props.providerId
  const zoneId = props.zoneId
  const name = domainName(record)
  if (!(await confirmDelete(name)) || !scopeOwner.active()) return
  await runBusy(name, async (owner) => {
    if (!scopeOwner.active()) return
    try {
      const response = await edgeOneApi.deleteAccelerationDomain(providerId, zoneId, name)
      if (!scopeOwner.active() || !owner.active()) return
      notifyDnsSideEffect(dnsSideEffectFromData(response, 'cleanup'), '已删除')
      removeListItem(domains, (item) => domainName(item) === name)
      selection.clear()
    } catch (error) {
      if (scopeOwner.active() && owner.active()) toast.error(errorMessage(error))
    }
  })
}

async function runEdgeBatch(
  create: () => Promise<{ data?: unknown }>,
  label: string,
  scopeOwner = captureMutationOwner(),
  providerId = props.providerId
) {
  if (!scopeOwner.active()) return
  await runBatchJob({
    label,
    create,
    fetchJob: async (id) => ((await edgeOneApi.batchJob(providerId, id)).data as Record<string, unknown>) || {},
    retry: (id) => edgeOneApi.batchRetry(providerId, id),
    clearSelection: () => selection.clear(),
    onDone: () => runLoad(),
    failureUnit: '个',
    jobProgress,
  })
}

async function batchDisableSelected() {
  const scopeOwner = captureMutationOwner()
  const providerId = scopeOwner.value.providerId
  const zoneId = scopeOwner.value.zoneId
  let list = selectedAvailableRows(pagedDomains.value, selection.selected.value, domainName, (row) =>
    isRowBusy(domainName(row))
  ).map(domainName)
  if (!list.length) {
    toast.warning('请先勾选加速域名')
    return
  }
  if (
    !(await confirmDialog({
      title: '批量停用',
      description: `确认停用已选 ${list.length} 个加速域名？`,
      confirmText: '停用',
      destructive: true,
    }))
  )
    return
  if (!scopeOwner.active()) return
  list = list.filter((name) => !isRowBusy(name))
  if (!list.length) return
  try {
    await runEdgeBatch(
      () => edgeOneApi.batchDisable(providerId, zoneId, { domains: list }),
      '批量停用',
      scopeOwner,
      providerId
    )
  } catch (error) {
    if (scopeOwner.active()) toast.error(errorMessage(error))
  }
}

async function batchDeleteSelected() {
  const scopeOwner = captureMutationOwner()
  const providerId = scopeOwner.value.providerId
  const zoneId = scopeOwner.value.zoneId
  let list = selectedAvailableRows(pagedDomains.value, selection.selected.value, domainName, (row) =>
    isRowBusy(domainName(row))
  ).map(domainName)
  if (!list.length) {
    toast.warning('请先勾选加速域名')
    return
  }
  if (
    !(await confirmDialog({
      title: '批量删除',
      description: `确认删除已选 ${list.length} 个加速域名？`,
      confirmText: '删除',
      destructive: true,
    }))
  )
    return
  if (!scopeOwner.active()) return
  list = list.filter((name) => !isRowBusy(name))
  if (!list.length) return
  try {
    await runEdgeBatch(
      () => edgeOneApi.batchDelete(providerId, zoneId, { domains: list }),
      '批量删除',
      scopeOwner,
      providerId
    )
  } catch (error) {
    if (scopeOwner.active()) toast.error(errorMessage(error))
  }
}

async function resumeJobs() {
  if (jobProgress.running.value) return
  const scopeOwner = captureMutationOwner()
  const finished = await jobProgress.resumeActive(
    () => edgeOneApi.batchActive(scopeOwner.value.providerId, scopeOwner.value.zoneId),
    {
      label: 'EdgeOne 批量',
      fetchJob: async (id) => ((await edgeOneApi.batchJob(props.providerId, id)).data as JobLike) || {},
    }
  )
  if (finished) {
    const jobId = String(finished.id || '')
    const failed = jobProgress.failedItems(finished)
    if (failed.length) {
      await showBatchFailures(
        finished.message || 'EdgeOne 批量完成',
        failed.map((i) => formatFailedJobItem(i)),
        '个',
        {
          onRetry: async () => {
            if (!scopeOwner.active()) return null
            await edgeOneApi.batchRetry(scopeOwner.value.providerId, jobId)
            if (!scopeOwner.active()) return null
            return jobProgress.pollJob(jobId, {
              label: 'EdgeOne 批量',
              fetchJob: async (id) =>
                ((await edgeOneApi.batchJob(scopeOwner.value.providerId, id)).data as JobLike) || {},
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
  () => [props.providerId, props.zoneId],
  () => {
    mutationGeneration.invalidate()
    dialogOpen.value = false
    certDialogOpen.value = false
    editingDomain.value = null
    saving.value = false
    jobProgress.reset()
    resetRowOperations()
    selection.clear()
    zoneMeta.value = null
    domains.value = []
    void runLoad()
      .then(() => (listActive() ? resumeJobs() : undefined))
      .catch(fail)
  }
)

onUnmounted(() => {
  mutationGeneration.invalidate()
  dialogOpen.value = false
  certDialogOpen.value = false
  jobProgress.reset()
  resetRowOperations()
})

onMounted(() => {
  void runLoad()
    .then(() => (listActive() ? resumeJobs() : undefined))
    .catch(fail)
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="pageTitle" description="EdgeOne 加速域名">
      <Button variant="outline" size="sm" @click="router.push('/' + encodePath(providerId))">返回站点</Button>
      <LoadingButton
        variant="outline"
        size="sm"
        :loading="refreshing"
        :disabled="loading && !refreshing"
        @click="onRefresh()"
      >
        <RefreshCw class="size-4" />
        刷新
      </LoadingButton>
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
        <div class="relative w-full sm:w-72">
          <Input
            v-model="keyword"
            class="h-8 w-full pr-7"
            placeholder="搜索加速域名 / CNAME"
            @keyup.enter="resetPage()"
          />
          <button
            v-if="keyword"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            title="清空"
            @click="clearSearch"
          >
            <X class="size-3.5" />
          </button>
        </div>
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

      <AccelerationDomainsTable
        :domains="pagedDomains"
        :loading="loading"
        :refreshing="refreshing"
        :selected="selection.selected.value"
        :domain-name="domainName"
        :busy="(record) => isRowBusy(domainName(record))"
        @update:selected="selection.selected.value = $event"
        @repair-dns="repairDomainDns"
        @edit="openEdit"
        @certificate="openCert"
        @status="setStatus"
        @remove="removeDomain"
      />

      <TablePagination
        :page="page"
        :page-size="pageSize"
        :total="total"
        :disabled="loading"
        @update:page="onPageChange"
        @update:page-size="onPageSizeChange"
      />
    </div>

    <!-- 勾选后：底部悬浮操作条 -->
    <FloatingSelectionBar
      :show="selectedCount > 0 && !jobProgress.running.value"
      :count="selectedCount"
      :disabled="jobProgress.running.value"
      @clear="selection.clear()"
    >
      <Button
        size="sm"
        class="h-7 px-3 text-xs cursor-pointer"
        :disabled="jobProgress.running.value"
        @click="batchDisableSelected"
      >
        批量停用
      </Button>
      <Button
        size="sm"
        variant="destructive"
        class="h-7 px-3 text-xs cursor-pointer"
        :disabled="jobProgress.running.value"
        @click="batchDeleteSelected"
      >
        批量删除
      </Button>
    </FloatingSelectionBar>

    <EdgeOneDomainForm
      v-model:open="dialogOpen"
      :zone-name="pageTitle"
      :dnspod-linked="dnspodLinked"
      :editing="!!editingDomain"
      :domain="editingDomain"
      :errors="formErrors"
      :saving="saving"
      @save="save"
    />
    <CertificateForm
      v-model:open="certDialogOpen"
      :certificate="editingDomain?.certificate"
      :errors="certErrors"
      :saving="saving"
      @save="saveCertificate"
    />
  </div>
</template>
