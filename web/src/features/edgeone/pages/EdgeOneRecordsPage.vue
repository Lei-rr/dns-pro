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
import { edgeOneApi, edgeOneStatusLabel } from '@/features/edgeone/api/edgeone'
import { providerPath } from '@/features/providers/lib/paths'
import type { EdgeOneAccelerationDomain, EdgeOneZone } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { errorMessage } from '@/shared/lib/errors'
import { handleRefresh, withMinLoading } from '@/shared/lib/loading'
import EdgeOneDomainForm from '@/features/edgeone/components/EdgeOneDomainForm.vue'
import CertificateForm from '@/features/edgeone/components/CertificateForm.vue'
import { JobProgressAlert } from '@/shared/ui/job-progress'
import { useJobProgress } from '@/shared/lib/job-progress'
import { formatFailedJobItem, showBatchFailures } from '@/shared/lib/batch'
import { useRowSelection } from '@/shared/lib/row-selection'
import { Checkbox } from '@/shared/ui/checkbox'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'

const props = defineProps<{ providerId: string; zoneId: string }>()
const router = useRouter()
const jobProgress = useJobProgress()

const loading = ref(false)
const refreshing = ref(false)
const saving = ref(false)
const domains = ref<EdgeOneAccelerationDomain[]>([])
const zoneMeta = ref<EdgeOneZone | null>(null)
const keyword = ref('')
const dialogOpen = ref(false)
const certDialogOpen = ref(false)
const editingDomain = ref<EdgeOneAccelerationDomain | null>(null)

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return domains.value
  return domains.value.filter((item) => {
    const name = String(item.domain_name || item.name || '').toLowerCase()
    const cname = String(item.cname || '').toLowerCase()
    return name.includes(q) || cname.includes(q)
  })
})
const selection = useRowSelection(filtered, (row) => String(row.domain_name || row.name || ''))
const selectedCount = computed(() => selection.selected.value.length)
const pageTitle = computed(() => zoneMeta.value?.name || decodeURIComponent(props.zoneId))

function domainName(record: EdgeOneAccelerationDomain) {
  return String(record.domain_name || record.name || '')
}

async function loadZoneMeta() {
  try {
    // Prefer list match so we get name without extra endpoint failures
    const response = await edgeOneApi.zones(props.providerId)
    const list = response.data || []
    zoneMeta.value =
      list.find((z) => String(z.id) === props.zoneId || String(z.name) === props.zoneId) || null
    if (!zoneMeta.value) {
      try {
        const one = await edgeOneApi.zone(props.providerId, props.zoneId)
        zoneMeta.value = one.data || null
      } catch {
        zoneMeta.value = null
      }
    }
  } catch {
    zoneMeta.value = null
  }
}

async function load(options: { refresh?: boolean } = {}) {
  await withMinLoading(loading, async () => {
    try {
    if (options.refresh || !zoneMeta.value) await loadZoneMeta()
    const response = await edgeOneApi.accelerationDomains(props.providerId, props.zoneId, {
      refresh: options.refresh,
    })
    domains.value = response.data || []
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

function openCreate() {
  editingDomain.value = null
  dialogOpen.value = true
}

function openEdit(record: EdgeOneAccelerationDomain) {
  editingDomain.value = record
  dialogOpen.value = true
}

function openCert(record: EdgeOneAccelerationDomain) {
  editingDomain.value = record
  certDialogOpen.value = true
}

async function save(payload: Record<string, unknown>) {
  saving.value = true
  try {
    if (editingDomain.value) {
      const response = await edgeOneApi.updateAccelerationDomain(
        props.providerId,
        props.zoneId,
        domainName(editingDomain.value),
        payload,
      )
      notifyDnsSideEffect((response as any).side_effects?.dns?.sync, '加速域名已更新')
    } else {
      const data: Record<string, unknown> = {
        domain_name: payload.fullDomain as string,
        origin: { type: payload.origin_type as string, value: payload.origin as string },
      }
      if (payload.origin_protocol) data.origin_protocol = payload.origin_protocol
      if (payload.http_origin_port) data.http_origin_port = payload.http_origin_port
      if (payload.https_origin_port) data.https_origin_port = payload.https_origin_port
      if (payload.ipv6_status) data.ipv6_status = payload.ipv6_status
      if (payload.host_header) (data.origin as Record<string, unknown>).host_header = payload.host_header
      const response = await edgeOneApi.createAccelerationDomain(props.providerId, props.zoneId, data, {
        autoSync: !!payload.autoSync,
      })
      notifyDnsSideEffect((response as any).side_effects?.dns?.sync, '加速域名已创建')
    }
    dialogOpen.value = false
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
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
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function setStatus(record: EdgeOneAccelerationDomain, status: string) {
  try {
    await edgeOneApi.updateAccelerationDomainStatus(props.providerId, props.zoneId, domainName(record), status)
    toast.success('状态已更新')
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function syncCname(record: EdgeOneAccelerationDomain) {
  try {
    const response = await edgeOneApi.syncAccelerationDomainCname(
      props.providerId,
      props.zoneId,
      domainName(record),
    )
    notifyDnsSideEffect((response as any).side_effects?.dns?.sync, 'CNAME 已同步')
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function removeDomain(record: EdgeOneAccelerationDomain) {
  const name = domainName(record)
  if (!(await confirmDelete(name))) return
  try {
    const response = await edgeOneApi.deleteAccelerationDomain(props.providerId, props.zoneId, name)
    notifyDnsSideEffect((response as any).side_effects?.dns?.cleanup, '已删除')
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function runEdgeBatch(
  create: () => Promise<{ data?: unknown }>,
  label: string,
) {
  const created = await create()
  const jobId = String((created.data as { id?: string } | null | undefined)?.id || '')
  if (!jobId) throw new Error(`${label}任务创建失败`)
  const poll = () =>
    jobProgress.pollJob(jobId, {
      label,
      fetchJob: async (id) => ((await edgeOneApi.batchJob(props.providerId, id)).data as any) || {},
    })
  const job = await poll()
  const failed = jobProgress.failedItems(job).map((item) => formatFailedJobItem(item))
  if (failed.length) {
    await showBatchFailures(job?.message || `${label}完成`, failed, '个', {
      onRetry: async () => {
        await edgeOneApi.batchRetry(props.providerId, jobId)
        return poll()
      },
    })
  } else {
    toast.success(job?.message || `${label}完成`)
  }
  selection.clear()
  await load({ refresh: true })
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
      fetchJob: async (id) => ((await edgeOneApi.batchJob(props.providerId, id)).data as any) || {},
    },
  )
  if (finished) {
    const failed = jobProgress.failedItems(finished)
    if (failed.length) {
      showBatchFailures(finished.message || 'EdgeOne 批量完成', failed.map((i) => formatFailedJobItem(i)), '个')
    }
    await load({ refresh: true })
  }
}

watch(
  () => [props.providerId, props.zoneId],
  () => {
    selection.clear()
    void load().then(() => resumeJobs())
  },
)

onMounted(() => {
  void load().then(() => resumeJobs())
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
          @keyup.enter="load()"
        />
        <Button variant="outline" size="sm" :loading="loading" @click="load()">
          <Search class="size-4" />
          搜索
        </Button>
        <template v-if="selectedCount">
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
            <TableRow v-for="record in filtered" :key="domainName(record)">
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
                    <Button variant="ghost" size="icon" class="size-8">
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @click="syncCname(record)">同步 CNAME</DropdownMenuItem>
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
    </div>

    <EdgeOneDomainForm
      v-model:open="dialogOpen"
      :zone-name="pageTitle"
      :editing="!!editingDomain"
      @save="save"
    />
    <CertificateForm
      v-model:open="certDialogOpen"
      :certificate="editingDomain?.certificate"
      @save="saveCertificate"
    />
  </div>
</template>
