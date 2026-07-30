<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, RefreshCw, Search } from '@lucide/vue'
import { PageHeader } from '@/shared/ui/page-header'
import { Button } from '@/shared/ui/button'
import { TablePagination } from '@/shared/ui/pagination'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldLabel } from '@/shared/ui/field'
import { preferredDomainApi, saasApi } from '@/features/saas/api/saas'
import { providerPath } from '@/features/providers/lib/paths'
import type { SaaSHostname, Zone } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { removeListItem } from '@/shared/lib/row-busy'
import { runProviderBatch } from '@/shared/lib/run-provider-batch'
import PreferredDomainsDialog from '@/features/saas/components/PreferredDomainsDialog.vue'
import FallbackOriginDialog from '@/features/saas/components/FallbackOriginDialog.vue'
import SaasDetailDialog from '@/features/saas/components/SaasDetailDialog.vue'
import HostnameFormDialog from '@/features/saas/components/HostnameFormDialog.vue'
import SaasHostsTable from '@/features/saas/components/SaasHostsTable.vue'
import { JobProgressAlert } from '@/shared/ui/job-progress'
import { useJobProgress } from '@/shared/lib/job-progress'
import { formatFailedJobItem, showBatchFailures } from '@/shared/lib/batch'
import { useRowSelection } from '@/shared/lib/row-selection'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { loadProviders, useProviderStore } from '@/features/providers/stores/providers'
import { dnsApi } from '@/features/dns/api/dns'

const props = defineProps<{ providerId: string; zoneName: string }>()
const router = useRouter()
const jobProgress = useJobProgress()

const saving = ref(false)
const applyingPreferred = ref(false)
const hostnames = ref<SaaSHostname[]>([])
const keyword = ref('')
const dialogOpen = ref(false)
const detailOpen = ref(false)
const detailLoading = ref(false)
const detailRefreshing = ref(false)
const rowRefreshing = ref('')
const detailRecord = ref<SaaSHostname | null>(null)
const batchPreferredOpen = ref(false)
const batchSubmitting = ref(false)
const batchPreferredDomain = ref('')
const preferredOptions = ref<Array<{ domain: string }>>([])
const editing = ref<SaaSHostname | null>(null)
const form = reactive({
  hostname: '',
  hostname_prefix: '',
  sync_provider_id: '',
  sync_zone: '',
  sync_target: '',
  custom_origin_server: '',
  use_custom_origin_server: true,
  preferred_domain: '__none',
  auto_preferred: true,
  method: 'txt',
  min_tls: '1.2',
  auto_sync: true,
})
const syncZones = ref<Zone[]>([])
const loadingSyncZones = ref(false)

const providerStore = useProviderStore()
const syncProviders = computed(() => {
  const list = providerStore.providers || []
  return list.filter((item) => item.type === 'dnspod' || item.type === 'cloudflare')
})
const selectedSyncProvider = computed(() =>
  syncProviders.value.find((item) => item.id === form.sync_provider_id) || null,
)
const selectedSyncTarget = computed(() => {
  const p = selectedSyncProvider.value
  if (!p) return form.sync_target || ''
  return p.type === 'dnspod' ? 'dnspod' : 'cloudflare_dns'
})
const usesGuidedHostname = computed(() => !editing.value && !!form.sync_provider_id)
const hostnamePreview = computed(() => {
  if (!usesGuidedHostname.value || !form.sync_zone) return ''
  const prefix = form.hostname_prefix.trim().toLowerCase()
  return prefix ? `${prefix}.${form.sync_zone}` : form.sync_zone
})
/** 与旧版一致：优先 custom_metadata，再顶层 preferred_domain */
function preferredDomainOf(record: SaaSHostname | null | undefined) {
  if (!record) return ''
  const meta = record.custom_metadata as Record<string, unknown> | null | undefined
  return String(meta?.preferred_domain || record.preferred_domain || '').trim()
}
/** 已用自定义源服务器（去重），给 AutoComplete 下拉 */
const originSuggestions = computed(() => {
  const seen = new Set<string>()
  const list: string[] = []
  for (const h of hostnames.value) {
    const v = String(h.custom_origin_server || '').trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      list.push(v)
    }
  }
  return list
})
const originSuggestOpen = ref(false)
function pickOriginSuggestion(value: string) {
  form.custom_origin_server = value
  originSuggestOpen.value = false
}
const showPreferred = ref(false)
const showFallback = ref(false)

const decodedZone = computed(() => decodeURIComponent(props.zoneName))
/** 全量主机名本地过滤，输入即生效。 */
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return hostnames.value
  return hostnames.value.filter((item) => String(item.hostname || '').toLowerCase().includes(q))
})
const { loading, refreshing, pageSize, runLoad, onRefresh, onPageSizeChange: setPageSize, fail } = useListPage({
  pageSizeScope: 'saas-hosts',
  load: async (options = {}) => {
    try {
      const response = await saasApi.hostnames(props.providerId, decodedZone.value, { refresh: options.refresh })
      if (options.isLatest && !options.isLatest()) return false
      hostnames.value = response.data || []
    } catch (error) {
      if (!options.isLatest || options.isLatest()) fail(error)
      return false
    }
  },
})
const { page, total, pagedItems: pagedHostnames, resetPage } = useLocalPagination(filtered, pageSize)
const selection = useRowSelection(pagedHostnames, (row) => String(row.hostname || ''))
const selectedCount = computed(() => selection.selected.value.length)
watch(keyword, () => {
  resetPage()
  selection.clear()
})


function patchHostnameRow(data: SaaSHostname | null | undefined) {
  if (!data) return
  const key = String(data.id || data.hostname || '')
  if (!key) return
  const idx = hostnames.value.findIndex(
    (item) => String(item.id || item.hostname) === key || String(item.hostname) === String(data.hostname),
  )
  if (idx >= 0) hostnames.value[idx] = data
  else hostnames.value = [data, ...hostnames.value]
  if (detailOpen.value && detailRecord.value?.hostname === data.hostname) {
    detailRecord.value = data
  }
}

async function loadSyncZones() {
  const providerId = form.sync_provider_id
  if (!providerId) {
    syncZones.value = []
    return
  }
  loadingSyncZones.value = true
  try {
    const response = await dnsApi.zones(providerId)
    syncZones.value = response.data || []
    if (!form.sync_zone && syncZones.value[0]?.name) {
      form.sync_zone = String(syncZones.value[0].name)
    }
  } catch {
    syncZones.value = []
  } finally {
    loadingSyncZones.value = false
  }
}

watch(
  () => form.sync_provider_id,
  (next, prev) => {
    if (!next || next === prev || editing.value) return
    form.sync_zone = ''
    void loadSyncZones()
  },
)

async function loadPreferredOptions() {
  try {
    const res = await preferredDomainApi.list()
    preferredOptions.value = res.data || []
  } catch {
    preferredOptions.value = []
  }
}

function resetForm() {
  const firstSync = syncProviders.value.find((p) => p.type === 'dnspod') || syncProviders.value[0]
  form.hostname = ''
  form.hostname_prefix = ''
  form.sync_provider_id = firstSync?.id || ''
  form.sync_zone = ''
  form.sync_target = firstSync?.type === 'cloudflare' ? 'cloudflare_dns' : firstSync ? 'dnspod' : ''
  form.custom_origin_server = ''
  form.use_custom_origin_server = true
  form.preferred_domain = preferredOptions.value[0]?.domain || '__none'
  form.auto_preferred = true
  form.method = 'txt'
  form.min_tls = '1.2'
  form.auto_sync = true
  void loadSyncZones()
}

function onPageChange(next: number) {
  page.value = next
  selection.clear()
}

function onPageSizeChange(next: number) {
  setPageSize(next)
  resetPage()
  selection.clear()
}

function onSearch() {
  resetPage()
}

async function openCreate() {
  editing.value = null
  await loadProviders()
  await loadPreferredOptions()
  resetForm()
  dialogOpen.value = true
}

function openEdit(record: SaaSHostname) {
  detailOpen.value = false
  editing.value = record
  form.hostname = record.hostname
  form.hostname_prefix = ''
  form.sync_provider_id = String(record.sync_provider_id || (record as any).effective_sync_provider_id || '')
  form.sync_zone = String(record.sync_zone || (record as any).effective_sync_zone || '')
  form.sync_target = String(record.sync_target || (record as any).effective_sync_target || '')
  form.custom_origin_server = String(record.custom_origin_server || '')
  form.use_custom_origin_server = !!form.custom_origin_server
  form.preferred_domain = preferredDomainOf(record) || '__none'
  form.auto_preferred = record.auto_preferred !== false
  form.method = String(record.ssl?.method || 'txt')
  form.min_tls = String((record.ssl as any)?.settings?.min_tls_version || (record.ssl as any)?.min_tls_version || '1.2')
  form.auto_sync = true
  void loadPreferredOptions()
  void loadSyncZones()
  dialogOpen.value = true
}

async function openDetails(record: SaaSHostname) {
  detailRecord.value = {
    ...record,
    ssl: { ...(record.ssl || {}) },
  }
  detailOpen.value = true
  detailLoading.value = true
  try {
    const response = await saasApi.hostname(props.providerId, decodedZone.value, record.hostname)
    if (response.data) {
      detailRecord.value = response.data
      patchHostnameRow(response.data)
    }
  } catch (error) {
    // list payload still usable; only toast if detail is empty-ish
    toast.error(errorMessage(error))
  } finally {
    detailLoading.value = false
  }
}

async function refreshDetailHostname(record: SaaSHostname) {
  detailRefreshing.value = true
  try {
    const response = await saasApi.hostname(props.providerId, decodedZone.value, record.hostname, { refresh: true })
    if (response.data) {
      patchHostnameRow(response.data)
    }
    toast.success('已刷新')
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    detailRefreshing.value = false
  }
}

async function save() {
  const hostname = (usesGuidedHostname.value ? hostnamePreview.value : form.hostname).trim()
  if (!hostname) {
    toast.warning(usesGuidedHostname.value ? '请选择同步域名' : '请填写主机名')
    return
  }
  if (form.use_custom_origin_server && !form.custom_origin_server.trim()) {
    toast.warning('请填写自定义源服务器，或关闭该开关')
    return
  }
  if (form.auto_preferred && form.preferred_domain === '__none') {
    toast.warning('开启自动优选时请选择优选域名')
    return
  }
  saving.value = true
  try {
    const preferred = form.preferred_domain === '__none' ? '' : form.preferred_domain
    const payload: Record<string, unknown> = {
      method: form.method,
      min_tls: form.min_tls,
      min_tls_version: form.min_tls,
      auto_preferred: form.auto_preferred,
      preferred_domain: preferred || undefined,
      custom_origin_server: form.use_custom_origin_server ? form.custom_origin_server.trim() : '',
      ssl: {
        method: form.method,
        settings: { min_tls_version: form.min_tls },
      },
    }

    if (editing.value) {
      // Edit: never rewrite sync_* — backend keeps existing DNS linkage
      const response = await saasApi.updateHostname(
        props.providerId,
        decodedZone.value,
        editing.value.hostname,
        payload,
        { autoSync: form.auto_sync },
      )
      notifyDnsSideEffect((response as any).side_effects?.dns?.sync, '主机名已更新')
      dialogOpen.value = false
      if (response.data) patchHostnameRow(response.data)
      else await runLoad()
    } else {
      if (form.sync_provider_id) {
        payload.sync_provider_id = form.sync_provider_id
        payload.sync_zone = form.sync_zone
        payload.sync_target = selectedSyncTarget.value
      }
      payload.hostname = hostname
      const response = await saasApi.createHostname(
        props.providerId,
        decodedZone.value,
        payload,
        { autoSync: form.auto_sync && !!payload.sync_target },
      )
      notifyDnsSideEffect((response as any).side_effects?.dns?.sync, '主机名已创建')
      dialogOpen.value = false
      // 新建影响分页 total / 排序，整表刷新更稳
      await runLoad()
    }
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function removeHostname(record: SaaSHostname) {
  if (!(await confirmDelete(record.hostname))) return
  const key = String(record.hostname || record.id || '')
  rowRefreshing.value = key
  try {
    const response = await saasApi.deleteHostname(props.providerId, decodedZone.value, record.hostname)
    notifyDnsSideEffect((response as any).side_effects?.dns?.cleanup, '已删除')
    removeListItem(
      hostnames,
      (item) => String(item.hostname) === String(record.hostname) || String(item.id) === String(record.id),
    )
    selection.clear()
    if (detailOpen.value && detailRecord.value?.hostname === record.hostname) {
      detailOpen.value = false
      detailRecord.value = null
    }
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    rowRefreshing.value = ''
  }
}

async function refreshHostname(record: SaaSHostname) {
  const key = String(record.hostname || record.id || '')
  if (!key || rowRefreshing.value) return
  rowRefreshing.value = key
  try {
    const response = await saasApi.hostname(props.providerId, decodedZone.value, record.hostname, { refresh: true })
    patchHostnameRow(response.data || null)
    toast.success('已刷新')
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    rowRefreshing.value = ''
  }
}

async function applyPreferred(payload: {
  domain: string
  onlyAutoPreferred?: boolean
  dryRun?: boolean
}) {
  applyingPreferred.value = true
  try {
    const body = {
      preferred_domain: payload.domain,
      only_auto_preferred: !!payload.onlyAutoPreferred,
      dry_run: !!payload.dryRun,
    }
    if (payload.dryRun) {
      const preview = await saasApi.preferredApplyPreview(props.providerId, decodedZone.value, body)
      const data = (preview.data || {}) as Record<string, unknown>
      toast.message(
        '预览完成',
        `将变更 ${Number(data.will_change || data.total || 0)} 项`,
      )
      return
    }
    await runProviderBatch({
      label: '后台切换',
      create: () => saasApi.preferredApply(props.providerId, decodedZone.value, body),
      fetchJob: async (id) => ((await saasApi.preferredApplyJob(id)).data as Record<string, unknown>) || {},
      retry: (id) => saasApi.preferredApplyRetry(id),
      onDone: () => runLoad(),
      failureUnit: '个',
      jobProgress,
    })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    applyingPreferred.value = false
  }
}

async function runBatchJob(
  create: () => Promise<{ data?: unknown }>,
  label: string,
) {
  await runProviderBatch({
    label,
    create,
    fetchJob: async (id) => ((await saasApi.batchJob(id)).data as Record<string, unknown>) || {},
    retry: (id) => saasApi.batchRetry(id),
    clearSelection: () => selection.clear(),
    onDone: () => runLoad(),
    failureUnit: '个',
    jobProgress,
  })
}

async function batchDeleteSelected() {
  const hostnamesList = selection.selected.value
  if (!hostnamesList.length) {
    toast.warning('请先勾选主机名')
    return
  }
  if (!(await confirmDialog({ title: '批量删除', description: `确认删除已选 ${hostnamesList.length} 个自定义主机名？`, confirmText: '删除', destructive: true }))) return
  try {
    await runBatchJob(
      () => saasApi.batchDelete(props.providerId, decodedZone.value, { hostnames: hostnamesList }),
      '批量删除',
    )
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function openBatchPreferred() {
  if (!selection.selected.value.length) {
    toast.warning('请先勾选主机名')
    return
  }
  try {
    const res = await preferredDomainApi.list()
    preferredOptions.value = res.data || []
    if (!preferredOptions.value.length) {
      toast.warning('还没有优选域名，请先在「优选域名」里添加')
      return
    }
    batchPreferredDomain.value = preferredOptions.value[0]?.domain || ''
    batchPreferredOpen.value = true
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function batchUpdatePreferred() {
  const preferred = batchPreferredDomain.value.trim()
  if (!preferred) {
    toast.warning('请选择优选域名')
    return
  }
  batchSubmitting.value = true
  batchPreferredOpen.value = false
  try {
    await runBatchJob(
      () =>
        saasApi.batchUpdate(props.providerId, decodedZone.value, {
          hostnames: selection.selected.value,
          patch: { preferred_domain: preferred, auto_preferred: true },
          auto_sync: true,
        }),
      '批量改优选',
    )
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    batchSubmitting.value = false
  }
}

async function resumeJobs() {
  if (jobProgress.running.value) return
  const fetchers: Array<{ label: string; fetchActive: () => Promise<any>; fetchJob: (id: string) => Promise<any> }> = [
    {
      label: '优选切换',
      fetchActive: () => saasApi.preferredApplyActive(props.providerId, decodedZone.value),
      fetchJob: async (id) => ((await saasApi.preferredApplyJob(id)).data as any) || {},
    },
    {
      label: 'SaaS 批量',
      fetchActive: () => saasApi.batchActive(props.providerId, decodedZone.value),
      fetchJob: async (id) => ((await saasApi.batchJob(id)).data as any) || {},
    },
  ]
  for (const item of fetchers) {
    const finished = await jobProgress.resumeActive(item.fetchActive, {
      label: item.label,
      fetchJob: item.fetchJob,
    })
    if (finished) {
      const failed = jobProgress.failedItems(finished)
      if (failed.length) {
        showBatchFailures(finished.message || `${item.label}完成`, failed.map((i) => formatFailedJobItem(i)), '个')
      }
      await runLoad()
      break
    }
  }
}

watch(
  () => [props.providerId, props.zoneName],
  () => {
    resetPage()
    selection.clear()
    void runLoad().then(() => resumeJobs()).catch(fail)
  },
)

onMounted(async () => {
  await loadProviders()

  void loadPreferredOptions()
  void runLoad().then(() => resumeJobs()).catch(fail)
})
</script>

<template>
  <div class="flex flex-1 flex-col gap-4">
    <PageHeader :title="decodedZone" description="Cloudflare SaaS 自定义主机名">
      <Button variant="outline" size="sm" @click="router.push(providerPath(providerId))">返回站点</Button>
      <Button variant="outline" size="sm" :disabled="loading" @click="onRefresh()">
        <RefreshCw class="size-4" :class="refreshing && 'animate-spin'" />
        刷新
      </Button>
      <Button variant="outline" size="sm" @click="showFallback = true">默认回源</Button>
      <Button variant="outline" size="sm" @click="showPreferred = true">优选域名</Button>
      <Button size="sm" @click="openCreate">
        <Plus class="size-4" />
        新增主机名
      </Button>
    </PageHeader>

    <JobProgressAlert
      :running="jobProgress.running.value || applyingPreferred"
      :text="jobProgress.text.value"
      title="SaaS 任务"
      :status="jobProgress.job.value?.status"
      :percent="jobProgress.percent.value"
    />

    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model="keyword"
          class="h-8 w-full sm:w-72"
          placeholder="搜索主机名"
          @keyup.enter="onSearch"
        />
        <Button variant="outline" size="sm" @click="onSearch">
          <Search class="size-4" />
          搜索
        </Button>
        <template v-if="selectedCount && !jobProgress.running.value && !applyingPreferred">
          <span class="text-muted-foreground text-sm">已选 {{ selectedCount }}</span>
          <Button variant="outline" size="sm" :disabled="jobProgress.running.value || batchSubmitting" @click="openBatchPreferred">
            批量改优选
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

      <SaasHostsTable
        :hostnames="pagedHostnames"
        :selected-hostnames="selection.selected.value"
        :loading="loading"
        :refreshing-hostname="rowRefreshing"
        :preferred-domain="preferredDomainOf"
        @update:selected-hostnames="selection.selected.value = $event"
        @detail="openDetails"
        @refresh="refreshHostname"
        @edit="openEdit"
        @remove="removeHostname"
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

    <HostnameFormDialog
      v-model:open="dialogOpen"
      v-model:form="form"
      :editing="!!editing"
      :saving="saving"
      :sync-providers="syncProviders"
      :sync-zones="syncZones"
      :preferred-options="preferredOptions"
      :origin-suggestions="originSuggestions"
      :origin-suggest-open="originSuggestOpen"
      @update:origin-suggest-open="originSuggestOpen = $event"
      @pick-origin="pickOriginSuggestion"
      @save="save"
    />

    <AppDialog
      v-model:open="batchPreferredOpen"
      title="批量修改优选域名"
      :description="`将把已选 ${selectedCount} 个主机名的优选域名改为：`"
    >
      <Field>
        <FieldLabel>优选域名</FieldLabel>
        <Select v-model="batchPreferredDomain">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择优选域名" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="item in preferredOptions" :key="item.domain" :value="item.domain">
              {{ item.domain }}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <template #footer>
        <Button variant="outline" @click="batchPreferredOpen = false">取消</Button>
        <Button @click="batchUpdatePreferred">开始修改</Button>
      </template>
    </AppDialog>

    <SaasDetailDialog
      v-model:open="detailOpen"
      :hostname="detailRecord"
      :loading="detailLoading"
      :refreshing="detailRefreshing"
      @edit="openEdit"
      @refresh="refreshDetailHostname"
    />
    <PreferredDomainsDialog
      v-model:open="showPreferred"
      :host-count="filtered.length"
      :applying="applyingPreferred || jobProgress.running.value"
      @apply="applyPreferred"
    />
    <FallbackOriginDialog
      v-model:open="showFallback"
      :provider-id="providerId"
      :zone-name="decodedZone"
    />
  </div>
</template>
