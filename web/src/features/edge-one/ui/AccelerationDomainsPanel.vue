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
import type { EdgeOneDomainSubmitPayload } from '@/features/edge-one/model/domain-command'
import { toast } from '@/shared/lib/toast'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { dnsSideEffectFromData } from '@/shared/lib/side-effects'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { useResourceQuery } from '@/shared/query'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { TablePagination } from '@/shared/ui/pagination'
import { useRowBusy, removeListItem, patchListItem } from '@/shared/lib/row-busy'
import AccelerationDomainFormDialog from '@/features/edge-one/ui/AccelerationDomainFormDialog.vue'
import CertificateFormDialog from '@/features/edge-one/ui/CertificateFormDialog.vue'
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
/** 视图镜像：保留面板内 patch/remove 的即时反馈，写后统一由 invalidate 收敛 */
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
// route 参数已由 vue-router 解码（畸形编码会回退原值），这里不再二次解码，避免含 '%' 的站点名抛 URIError
const pageTitle = computed(() => zoneMeta.value?.name || props.zoneId)
/** 站点元数据是否就绪：未就绪时不允许新增（否则会拿 zoneId 当域名拼出错误的主机名） */
const zoneMetaReady = computed(() => Boolean(zoneMeta.value?.name))

type EdgeOneDomainsData = { domains: EdgeOneAccelerationDomain[]; zoneMeta: EdgeOneZone | null }

const domainsQuery = useResourceQuery<EdgeOneDomainsData>({
  key: () => ['edgeone', 'domains', props.providerId, props.zoneId],
  queryFn: async ({ refresh, signal }) => {
    const [response, meta] = await Promise.all([
      edgeOneApi.accelerationDomains(props.providerId, props.zoneId, { refresh, signal }),
      loadZoneMeta(refresh, signal),
    ])
    return { domains: response.data || [], zoneMeta: meta }
  },
  pageSizeScope: 'edgeone-records',
})
const loading = domainsQuery.loading
const refreshing = domainsQuery.refreshing
const pageSize = domainsQuery.pageSize
const runLoad = () => domainsQuery.invalidate()
watch(domainsQuery.data, (data) => {
  if (!data) return
  domains.value = data.domains
  if (data.zoneMeta) zoneMeta.value = data.zoneMeta
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
  domainsQuery.setPageSize(next)
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

async function loadZoneMeta(refresh = false, signal?: AbortSignal): Promise<EdgeOneZone | null> {
  try {
    // Prefer list match so we get name without extra endpoint failures
    const response = await edgeOneApi.zones(props.providerId, { refresh, signal })
    const list = response.data || []
    const matched = list.find((z) => String(z.id) === props.zoneId || String(z.name) === props.zoneId) || null
    if (matched) return matched
    try {
      const one = await edgeOneApi.zone(props.providerId, props.zoneId, { refresh, signal })
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

async function save(payload: EdgeOneDomainSubmitPayload) {
  if (saving.value) return
  const editingName = editingDomain.value ? domainName(editingDomain.value) : ''
  if (!editingName && !zoneMetaReady.value) {
    toast.error('站点信息尚未加载完成，请稍后重试')
    return
  }
  const owner = mutationGeneration.claim({ providerId: props.providerId, zoneId: props.zoneId })
  saving.value = true
  try {
    const data: Record<string, unknown> = {
      origin_type: payload.origin_type,
      origin: payload.origin,
    }
    if (!editingName) data.domain_name = payload.fullDomain
    if (payload.origin_protocol) data.origin_protocol = payload.origin_protocol
    // 端口按数值提交（0/空值不再被静默忽略，交给后端 schema 统一校验）
    if (Number.isFinite(Number(payload.http_origin_port))) {
      data.http_origin_port = Number(payload.http_origin_port)
    }
    if (Number.isFinite(Number(payload.https_origin_port))) {
      data.https_origin_port = Number(payload.https_origin_port)
    }
    if (payload.ipv6_status) data.ipv6_status = payload.ipv6_status
    // 空串也是有效载荷：它是「清空自定义 HOST」的唯一载体，falsy 判断会吞掉清空意图
    if (payload.host_header !== undefined) data.host_header = payload.host_header

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
        autoSync: payload.autoSync,
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

/** 停止加速与启用都是异步的：上游接受后域名进入 process（实测两分钟以上），期间改状态/删除都会被拒绝。
 *  这里沿用 shared/job 的轮询写法（定时读取 + 作用域所有权）等状态落定，删除入口只在确认落为 offline 后出现。 */
const STATUS_POLL_INTERVAL_MS = 5000
const STATUS_POLL_MAX_ATTEMPTS = 60

/** 轮询该域名的真实状态直到离开 process（或超出等待上限）；返回最终状态，域名已消失时返回 'gone' */
async function waitForDomainStatusSettled(key: string, owner: { active: () => boolean }): Promise<string> {
  let status = 'process'
  for (let attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS))
    if (!owner.active()) return ''
    // refresh 绕过服务端缓存：否则轮询只会读回上一次的 process 快照
    const response = await edgeOneApi.accelerationDomains(props.providerId, props.zoneId, { refresh: true })
    if (!owner.active()) return ''
    const latest = (response.data || []).find((item) => domainName(item) === key)
    if (!latest) return 'gone'
    status = String(latest.status || '')
    patchListItem(
      domains,
      (item) => domainName(item) === key,
      (item) => ({ ...item, status: latest.status, active_status: latest.status })
    )
    if (status.toLowerCase() !== 'process') return status
  }
  return status
}

/** 上下线切换的文案：目标态 → 下发中 / 完成 / 超时提醒 */
const STATUS_TRANSITION_TEXT: Record<'online' | 'offline', { sending: string; done: string; pending: string }> = {
  offline: { sending: '停止指令已下发', done: '已停止加速', pending: '停止加速仍在进行中' },
  online: { sending: '启用指令已下发', done: '已启用加速', pending: '启用加速仍在进行中' },
}

/** 停止/启用共用流程：下发 → 按真实过渡态 process 展示 → 轮询到落定 → 整表收敛 */
async function setAccelerationStatus(record: EdgeOneAccelerationDomain, status: 'online' | 'offline') {
  const key = domainName(record)
  const text = STATUS_TRANSITION_TEXT[status]
  await runBusy(key, async (owner) => {
    try {
      await edgeOneApi.updateAccelerationDomainStatus(props.providerId, props.zoneId, key, status)
      if (!owner.active()) return
      // 下发后上游进入 process：按真实过渡态展示，避免乐观显示目标态又被上游打回
      patchListItem(
        domains,
        (item) => domainName(item) === key,
        (item) => ({ ...item, status: 'process', active_status: 'process' })
      )
      toast.message(text.sending, '等待 EdgeOne 完成配置…')
      const settled = (await waitForDomainStatusSettled(key, owner)).toLowerCase()
      if (!owner.active()) return
      await runLoad()
      if (!owner.active()) return
      if (settled === status) toast.success(text.done)
      // 超时仍是 process：保留「配置中」视图，提醒用户稍后刷新
      else if (settled === 'process') toast.warning(text.pending, '可稍后刷新查看状态')
    } catch (error) {
      // 行数据只在成功后改写，失败时无需回滚（回滚反而会覆盖并发刷新的新值）
      if (owner.active()) toast.error(errorMessage(error))
    }
  })
}

/** 两步走第一步：online → 停止加速 → 等上游落为 offline，删除入口随状态自然出现 */
function stopAcceleration(record: EdgeOneAccelerationDomain) {
  return setAccelerationStatus(record, 'offline')
}

/** 停用后的回头路：offline → 启用 → 等上游落回 online，删除入口随之收起 */
function enableAcceleration(record: EdgeOneAccelerationDomain) {
  return setAccelerationStatus(record, 'online')
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
    fetchJob: async (id) => (await edgeOneApi.batchJob(providerId, id)).data as Record<string, unknown>,
    retry: (id) => edgeOneApi.batchRetry(providerId, id),
    clearSelection: () => selection.clear(),
    onDone: () => runLoad(),
    failureUnit: '个',
    jobProgress,
  })
}

/** 批量停用/删除只差动词与接口，共用同一套「校验选中 → 二次确认 → 执行」流程 */
const BATCH_ACTIONS = {
  disable: {
    verb: '停用',
    run: (providerId: string, zoneId: string, domains: string[]) =>
      edgeOneApi.batchDisable(providerId, zoneId, { domains }),
  },
  delete: {
    verb: '删除',
    run: (providerId: string, zoneId: string, domains: string[]) =>
      edgeOneApi.batchDelete(providerId, zoneId, { domains }),
  },
} as const

async function runBatchWithConfirm(kind: 'disable' | 'delete') {
  const action = BATCH_ACTIONS[kind]
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
      title: `批量${action.verb}`,
      description: `确认${action.verb}已选 ${list.length} 个加速域名？`,
      confirmText: action.verb,
      destructive: true,
    }))
  )
    return
  if (!scopeOwner.active()) return
  list = list.filter((name) => !isRowBusy(name))
  if (!list.length) return
  try {
    await runEdgeBatch(() => action.run(providerId, zoneId, list), `批量${action.verb}`, scopeOwner, providerId)
  } catch (error) {
    if (scopeOwner.active()) toast.error(errorMessage(error))
  }
}

function batchDisableSelected() {
  return runBatchWithConfirm('disable')
}

function batchDeleteSelected() {
  return runBatchWithConfirm('delete')
}

async function resumeJobs() {
  if (jobProgress.running.value) return
  const scopeOwner = captureMutationOwner()
  const finished = await jobProgress.resumeActive(
    () => edgeOneApi.batchActive(scopeOwner.value.providerId, scopeOwner.value.zoneId),
    {
      label: 'EdgeOne 批量',
      fetchJob: async (id) => (await edgeOneApi.batchJob(scopeOwner.value.providerId, id)).data as JobLike,
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
              fetchJob: async (id) => (await edgeOneApi.batchJob(scopeOwner.value.providerId, id)).data as JobLike,
            })
          },
          isActive: () => scopeOwner.active(),
        }
      )
    } else if (scopeOwner.active()) {
      toast.success(finished.message || 'EdgeOne 批量已完成')
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
    // 搜索词与页码属于上一个站点：不清理会让新列表被旧关键词过滤成空表
    keyword.value = ''
    resetPage()
    void domainsQuery.invalidate()
    void resumeJobs()
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
  void resumeJobs()
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
        @click="domainsQuery.refresh()"
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
        <span v-if="selectedCount && !jobProgress.running.value" class="text-muted-foreground text-sm">
          已选 {{ selectedCount }}
        </span>
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
        @stop="stopAcceleration"
        @enable="enableAcceleration"
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

    <AccelerationDomainFormDialog
      v-model:open="dialogOpen"
      :zone-name="pageTitle"
      :dnspod-linked="dnspodLinked"
      :editing="!!editingDomain"
      :domain="editingDomain"
      :errors="formErrors"
      :saving="saving"
      @save="save"
    />
    <CertificateFormDialog
      v-model:open="certDialogOpen"
      :certificate="editingDomain?.certificate"
      :errors="certErrors"
      :saving="saving"
      @save="saveCertificate"
    />
  </div>
</template>
