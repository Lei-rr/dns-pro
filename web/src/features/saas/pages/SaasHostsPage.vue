<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableLoading } from '@/shared/ui/table'
import { TablePagination } from '@/shared/ui/pagination'
import { AppDialog } from '@/shared/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { saasApi } from '@/features/saas/api/saas'
import { providerPath } from '@/features/providers/lib/paths'
import type { SaaSHostname, Zone } from '@/shared/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { handleRefresh, withMinLoading } from '@/shared/lib/loading'
import PreferredDomainsDialog from '@/features/saas/components/PreferredDomainsDialog.vue'
import FallbackOriginDialog from '@/features/saas/components/FallbackOriginDialog.vue'
import { JobProgressAlert } from '@/shared/ui/job-progress'
import { useJobProgress } from '@/shared/lib/job-progress'
import { formatFailedJobItem, showBatchFailures } from '@/shared/lib/batch'
import { useRowSelection } from '@/shared/lib/row-selection'
import { Checkbox } from '@/shared/ui/checkbox'
import { preferredDomainApi } from '@/features/saas/api/saas'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { loadProviders, useProviderStore } from '@/features/providers/stores/providers'
import { dnsApi } from '@/features/dns/api/dns'

const props = defineProps<{ providerId: string; zoneName: string }>()
const router = useRouter()
const jobProgress = useJobProgress()

const loading = ref(false)
const refreshing = ref(false)
const saving = ref(false)
const applyingPreferred = ref(false)
const hostnames = ref<SaaSHostname[]>([])
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const dialogOpen = ref(false)
const batchPreferredOpen = ref(false)
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
const preferredLabel = computed(() => '优选域名')
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
const filteredOriginSuggestions = computed(() => {
  const q = form.custom_origin_server.trim().toLowerCase()
  if (!q) return originSuggestions.value
  return originSuggestions.value.filter((item) => item.toLowerCase().includes(q))
})
function pickOriginSuggestion(value: string) {
  form.custom_origin_server = value
  originSuggestOpen.value = false
}
const showPreferred = ref(false)
const showFallback = ref(false)

const decodedZone = computed(() => decodeURIComponent(props.zoneName))
/** 当前页数据 + 本页关键字过滤（CF 列表为服务端分页，搜索仅过滤当前页） */
const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return hostnames.value
  return hostnames.value.filter((item) => String(item.hostname || '').toLowerCase().includes(q))
})
const selection = useRowSelection(filtered, (row) => String(row.hostname || ''))
const selectedCount = computed(() => selection.selected.value.length)

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

async function load(options: { refresh?: boolean } = {}) {
  await withMinLoading(loading, async () => {
    try {
      const response = await saasApi.hostnames(props.providerId, decodedZone.value, {
        page: page.value,
        per_page: pageSize.value,
        refresh: options.refresh,
      })
      hostnames.value = response.data || []
      const meta = (response as { meta?: Record<string, unknown> }).meta || {}
      // CF pagination uses total_count; unwrapItems maps pagination into meta
      const rawTotal = meta.total_count ?? meta.total ?? meta.count
      total.value = Number(
        rawTotal != null && rawTotal !== '' ? rawTotal : hostnames.value.length || 0,
      )
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
  void load()
}

function onPageSizeChange(next: number) {
  pageSize.value = next
  page.value = 1
  selection.clear()
  void load()
}

function onSearch() {
  // CF hostnames API 无 keyword 参数：回第一页 + 本页过滤
  page.value = 1
  selection.clear()
  void load()
}

async function openCreate() {
  editing.value = null
  await loadProviders()
  await loadPreferredOptions()
  resetForm()
  dialogOpen.value = true
}

function openEdit(record: SaaSHostname) {
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
    }
    dialogOpen.value = false
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  } finally {
    saving.value = false
  }
}

async function removeHostname(record: SaaSHostname) {
  if (!(await confirmDelete(record.hostname))) return
  try {
    const response = await saasApi.deleteHostname(props.providerId, decodedZone.value, record.hostname)
    notifyDnsSideEffect((response as any).side_effects?.dns?.cleanup, '已删除')
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

async function refreshHostname(record: SaaSHostname) {
  try {
    await saasApi.refreshHostname(props.providerId, decodedZone.value, record.hostname)
    toast.success('已刷新')
    await load({ refresh: true })
  } catch (error) {
    toast.error(errorMessage(error))
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
    const created = await saasApi.preferredApply(props.providerId, decodedZone.value, body)
    const jobId = String((created.data as { id?: string } | undefined)?.id || '')
    if (!jobId) throw new Error('创建优选切换任务失败')
    const job = await jobProgress.pollJob(jobId, {
      label: '后台切换',
      fetchJob: async (id) => ((await saasApi.preferredApplyJob(id)).data as any) || {},
    })
    const failed = jobProgress.failedItems(job).map((item) => formatFailedJobItem(item))
    if (failed.length) {
      showBatchFailures(job?.message || '优选切换完成', failed, '个', {
        onRetry: async () => {
          await saasApi.preferredApplyRetry(jobId)
          toast.message('已提交重试')
        },
      })
    } else {
      toast.success(job?.message || '优选切换完成')
    }
    await load({ refresh: true })
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
  const created = await create()
  const jobId = String((created.data as { id?: string } | null | undefined)?.id || '')
  if (!jobId) throw new Error(`${label}任务创建失败`)
  const job = await jobProgress.pollJob(jobId, {
    label,
    fetchJob: async (id) => ((await saasApi.batchJob(id)).data as any) || {},
  })
  const failed = jobProgress.failedItems(job).map((item) => formatFailedJobItem(item))
  if (failed.length) {
    showBatchFailures(job?.message || `${label}完成`, failed, '个', {
      onRetry: async () => {
        await saasApi.batchRetry(jobId)
        toast.message('已提交重试')
      },
    })
  } else {
    toast.success(job?.message || `${label}完成`)
  }
  selection.clear()
  await load({ refresh: true })
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
  try {
    batchPreferredOpen.value = false
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
      await load({ refresh: true })
      break
    }
  }
}

watch(
  () => [props.providerId, props.zoneName],
  () => {
    page.value = 1
    selection.clear()
    void load().then(() => resumeJobs())
  },
)

onMounted(async () => {
  await loadProviders()

  void loadPreferredOptions()
  void load().then(() => resumeJobs())
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
      :percent="jobProgress.percent.value"
      
    />

    <div class="flex w-full flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model="keyword"
          class="h-8 w-full sm:w-72"
          placeholder="搜索主机名（当前页）"
          @keyup.enter="onSearch"
        />
        <Button variant="outline" size="sm" @click="onSearch">
          <Search class="size-4" />
          搜索
        </Button>
        <template v-if="selectedCount">
          <span class="text-muted-foreground text-sm">已选 {{ selectedCount }}</span>
          <Button variant="outline" size="sm" :disabled="jobProgress.running.value" @click="openBatchPreferred">
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
              <TableHead>主机名</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>证书</TableHead>
              <TableHead>回源</TableHead>
              <TableHead>优选域名</TableHead>
              <TableHead class="rounded-r-lg w-12" />
            </TableRow>
          </TableHeader>
          <TableBody class="**:data-[slot=table-cell]:py-2.5">
            <TableRow v-if="!filtered.length && !loading">
              <TableCell colspan="7" class="text-muted-foreground py-10 text-center">暂无自定义主机名</TableCell>
            </TableRow>
            <TableRow v-for="record in filtered" :key="String(record.id || record.hostname)">
              <TableCell class="px-3">
                <Checkbox
                  :model-value="selection.isSelected(record)"
                  @update:model-value="(v: boolean | 'indeterminate') => selection.toggle(record, v === true)"
                @click.stop
                />
              </TableCell>
              <TableCell class="font-medium">{{ record.hostname }}</TableCell>
              <TableCell>
                <Badge variant="secondary">{{ record.status || '-' }}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{{ record.ssl?.status || '-' }}</Badge>
              </TableCell>
              <TableCell class="max-w-[180px] truncate">
                {{ record.custom_origin_server || '默认回源' }}
              </TableCell>
              <TableCell class="max-w-[160px] truncate" :title="preferredDomainOf(record) || undefined">
                {{ preferredDomainOf(record) || '—' }}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="size-8">
                      <EllipsisVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @click="refreshHostname(record)">刷新</DropdownMenuItem>
                    <DropdownMenuItem @click="openEdit(record)">编辑</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" @click="removeHostname(record)">删除</DropdownMenuItem>
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

    <AppDialog
      v-model:open="dialogOpen"
      :title="editing ? '编辑主机名' : '新增主机名'"
      description="创建/更新 Cloudflare for SaaS 自定义主机名。"
      content-class="sm:max-w-xl"
    >
      <FieldGroup>
        <template v-if="editing">
          <Field>
            <FieldLabel>主机名</FieldLabel>
            <Input v-model="form.hostname" disabled />
          </Field>
        </template>
        <template v-else>
          <Field v-if="syncProviders.length">
            <FieldLabel>同步服务商</FieldLabel>
            <Select v-model="form.sync_provider_id">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择同步服务商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="item in syncProviders" :key="item.id" :value="item.id">
                  {{ item.name }}（{{ item.type === 'dnspod' ? 'DNSPod' : 'Cloudflare' }}）
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div v-if="form.sync_provider_id" class="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>主机名前缀</FieldLabel>
              <Input v-model="form.hostname_prefix" placeholder="如 app；留空表示根域名" />
            </Field>
            <Field>
              <FieldLabel>同步域名</FieldLabel>
              <Select v-model="form.sync_zone">
                <SelectTrigger class="w-full">
                  <SelectValue :placeholder="'选择域名'" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="zone in syncZones" :key="String(zone.name)" :value="String(zone.name)">
                    {{ zone.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field v-if="!form.sync_provider_id">
            <FieldLabel>主机名</FieldLabel>
            <Input v-model="form.hostname" placeholder="www.example.com" />
          </Field>
        </template>

        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>DCV 认证</FieldLabel>
            <Select v-model="form.method">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择验证方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="txt">TXT 验证（推荐）</SelectItem>
                <SelectItem value="http">HTTP 验证</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>最低 TLS 版本</FieldLabel>
            <Select v-model="form.min_tls">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="TLS" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1.0">TLS 1.0</SelectItem>
                <SelectItem value="1.1">TLS 1.1</SelectItem>
                <SelectItem value="1.2">TLS 1.2</SelectItem>
                <SelectItem value="1.3">TLS 1.3</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field orientation="horizontal">
          <Switch v-model="form.use_custom_origin_server" />
          <FieldLabel>自定义源服务器</FieldLabel>
        </Field>
        <Field v-if="form.use_custom_origin_server" class="relative">
          <!-- 对齐旧版 a-auto-complete：可输可选，下拉已用源服务器 -->
          <Input
            v-model="form.custom_origin_server"
            placeholder="输入或从已用源服务器选择，如 origin.example.com"
            autocomplete="off"
            @focus="originSuggestOpen = true"
            @input="originSuggestOpen = true"
            @keydown.escape="originSuggestOpen = false"
          />
          <div
            v-if="originSuggestOpen && filteredOriginSuggestions.length"
            class="bg-popover text-popover-foreground absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border shadow-md"
            @mousedown.prevent
          >
            <button
              v-for="item in filteredOriginSuggestions"
              :key="item"
              type="button"
              class="hover:bg-accent hover:text-accent-foreground flex w-full items-center px-3 py-2 text-left text-sm"
              @click="pickOriginSuggestion(item)"
            >
              {{ item }}
            </button>
          </div>
        </Field>

        <Field orientation="horizontal">
          <Switch v-model="form.auto_preferred" />
          <FieldLabel>自动优选</FieldLabel>
        </Field>
        <Field v-if="form.auto_preferred">
          <FieldLabel>优选域名</FieldLabel>
          <Select v-model="form.preferred_domain">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="选择优选域名" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">不使用优选</SelectItem>
              <SelectItem v-for="item in preferredOptions" :key="item.domain" :value="item.domain">
                {{ item.domain }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal">
          <Switch v-model="form.auto_sync" />
          <FieldLabel>同步写回 DNS</FieldLabel>
        </Field>
      </FieldGroup>
      <template #footer>
        <Button variant="outline" @click="dialogOpen = false">取消</Button>
        <Button :loading="saving" @click="save">保存</Button>
      </template>
    </AppDialog>

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
