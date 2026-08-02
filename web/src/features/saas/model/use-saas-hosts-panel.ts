import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { preferredDomainApi, saasApi } from '@/features/saas/api/saas-api'
import type { SaaSHostname, SaaSSyncProvider } from '@/features/saas/model/types'
import { confirmDelete, confirmDialog } from '@/shared/ui/confirm'
import { useSaasHostJobs } from './use-saas-host-jobs'
import { preferredDomainOf, useSaasHostEditor } from './use-saas-host-editor'
import type { DnsZoneOption } from '../model/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useListPage } from '@/shared/lib/use-list-page'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { removeListItem, useRowBusy } from '@/shared/lib/row-busy'
import { selectedAvailableRows, useRowSelection } from '@/shared/lib/row-selection'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { dnsSideEffectFromData } from '@/shared/lib/dns-side-effects'
import { createScopeGeneration, type ScopeOwner } from '@/shared/lib/scope-generation'
import type { SaasScope } from './use-saas-host-jobs'

export interface SaasHostsPanelProps {
  providerId: string
  zoneName: string
  loadDnsZones: (providerId: string) => Promise<DnsZoneOption[]>
  syncProviders: SaaSSyncProvider[]
}

export function useSaasHostsPanel(props: SaasHostsPanelProps) {
  const router = useRouter()

  const hostnames = ref<SaaSHostname[]>([])
  const keyword = ref('')
  const detailOpen = ref(false)
  const detailLoading = ref(false)
  const detailRefreshing = ref(false)
  const { busyKeys: rowBusyKeys, isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()
  const detailRequestGeneration = createScopeGeneration()
  const scopeGeneration = createScopeGeneration()
  const detailRecord = ref<SaaSHostname | null>(null)
  const batchPreferredOpen = ref(false)
  const batchSubmitting = ref(false)
  const batchPreferredDomain = ref('')
  const batchPreferredError = ref('')

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

  const showPreferred = ref(false)
  const showFallback = ref(false)
  let preferredDialogOwner: ScopeOwner<SaasScope> | null = null

  const decodedZone = computed(() => decodeURIComponent(props.zoneName))
  function captureScope(): ScopeOwner<SaasScope> {
    return scopeGeneration.capture({ providerId: props.providerId, zoneName: decodedZone.value })
  }

  function openPreferred() {
    preferredDialogOwner = captureScope()
    showPreferred.value = true
  }

  function applyPreferredFromDialog(payload: { domain: string; onlyAutoPreferred?: boolean; dryRun?: boolean }) {
    const owner = preferredDialogOwner
    if (!owner?.active()) return
    return applyPreferred(owner, payload)
  }
  /** 全量主机名本地过滤，输入即生效。 */
  const filtered = computed(() => {
    const q = keyword.value.trim().toLowerCase()
    if (!q) return hostnames.value
    return hostnames.value.filter((item) =>
      String(item.hostname || '')
        .toLowerCase()
        .includes(q)
    )
  })
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
    pageSizeScope: 'saas-hosts',
    load: async (options = {}) => {
      try {
        const response = await saasApi.hostnames(props.providerId, decodedZone.value, { refresh: options.refresh })
        if (options.isLatest && !options.isLatest()) return false
        hostnames.value = response.data || []
        return true
      } catch (error) {
        if (!options.isLatest || options.isLatest()) fail(error)
        return false
      }
    },
  })
  const { page, total, pagedItems: pagedHostnames, resetPage } = useLocalPagination(filtered, pageSize)
  const selection = useRowSelection(pagedHostnames, (row) => String(row.hostname || ''))
  const selectedCount = computed(() => selection.selected.value.length)
  const {
    jobProgress,
    applyingPreferred,
    applyPreferred,
    runBatch: runBatchJob,
    resume: resumeJobs,
    reset: resetJobs,
  } = useSaasHostJobs({
    providerId: () => props.providerId,
    zoneName: () => decodedZone.value,
    reload: () => runLoad(),
    clearSelection: () => selection.clear(),
  })
  watch(keyword, () => {
    resetPage()
    selection.clear()
  })
  watch(detailOpen, (open) => {
    if (open) return
    detailRequestGeneration.invalidate()
    detailLoading.value = false
    detailRefreshing.value = false
  })

  function patchHostnameRow(data: SaaSHostname | null | undefined) {
    if (!data) return
    const key = String(data.id || data.hostname || '')
    if (!key) return
    const idx = hostnames.value.findIndex(
      (item) => String(item.id || item.hostname) === key || String(item.hostname) === String(data.hostname)
    )
    if (idx >= 0) hostnames.value[idx] = data
    else hostnames.value = [data, ...hostnames.value]
    if (detailOpen.value && detailRecord.value?.hostname === data.hostname) {
      detailRecord.value = data
    }
  }

  const {
    saving,
    dialogOpen,
    editing,
    formErrors,
    form,
    syncZones,
    syncZonesError,
    preferredOptions,
    preferredOptionsError,
    syncProviders,
    loadSyncZones,
    loadPreferredOptions,
    openCreate,
    openEdit,
    save,
    reset: resetEditor,
  } = useSaasHostEditor({
    providerId: () => props.providerId,
    zoneName: () => decodedZone.value,
    loadDnsZones: props.loadDnsZones,
    reload: () => runLoad(),
    patchHostname: patchHostnameRow,
    closeDetail: () => {
      detailRequestGeneration.invalidate()
      detailOpen.value = false
    },
    rowBusy: isRowBusy,
    syncProviders: () => props.syncProviders,
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

  function onSearch() {
    resetPage()
  }

  function detailIdentity(record: SaaSHostname) {
    return JSON.stringify([props.providerId, decodedZone.value, String(record.hostname || '')])
  }

  function isCurrentDetail(owner: { active: () => boolean }, identity: string) {
    return (
      owner.active() &&
      detailOpen.value &&
      detailRecord.value != null &&
      detailIdentity(detailRecord.value) === identity
    )
  }

  async function openDetails(record: SaaSHostname) {
    if (isRowBusy(hostnameKey(record))) return
    const owner = detailRequestGeneration.claim()
    const identity = detailIdentity(record)
    detailRecord.value = { ...record, ssl: { ...(record.ssl || {}) } }
    detailOpen.value = true
    detailLoading.value = true
    try {
      const response = await saasApi.hostname(props.providerId, decodedZone.value, record.hostname)
      if (!isCurrentDetail(owner, identity)) return
      if (response.data) {
        detailRecord.value = response.data
        patchHostnameRow(response.data)
      }
    } catch (error) {
      if (isCurrentDetail(owner, identity)) toast.error(errorMessage(error))
    } finally {
      if (isCurrentDetail(owner, identity)) detailLoading.value = false
    }
  }

  async function refreshDetailHostname(record: SaaSHostname) {
    const key = hostnameKey(record)
    await runBusy(key, async (rowOwner) => {
      const detailOwner = detailRequestGeneration.claim()
      const identity = detailIdentity(record)
      detailRefreshing.value = true
      try {
        const response = await saasApi.hostname(props.providerId, decodedZone.value, record.hostname, { refresh: true })
        if (!rowOwner.active() || !isCurrentDetail(detailOwner, identity)) return
        if (response.data) patchHostnameRow(response.data)
        toast.success('已刷新')
      } catch (error) {
        if (rowOwner.active() && isCurrentDetail(detailOwner, identity)) toast.error(errorMessage(error))
      } finally {
        if (rowOwner.active() && isCurrentDetail(detailOwner, identity)) detailRefreshing.value = false
      }
    })
  }

  function hostnameKey(record: SaaSHostname) {
    return String(record.hostname || record.id || '')
  }

  async function removeHostname(record: SaaSHostname) {
    const scopeOwner = captureScope()
    const hostname = record.hostname
    const key = hostnameKey(record)
    if (!key || isRowBusy(key) || !(await confirmDelete(hostname)) || !scopeOwner.active()) return
    await runBusy(key, async (owner) => {
      if (!scopeOwner.active()) return
      try {
        const response = await saasApi.deleteHostname(scopeOwner.value.providerId, scopeOwner.value.zoneName, hostname)
        if (!scopeOwner.active() || !owner.active()) return
        notifyDnsSideEffect(dnsSideEffectFromData(response, 'cleanup'), '已删除')
        removeListItem(
          hostnames,
          (item) => String(item.hostname) === String(record.hostname) || String(item.id) === String(record.id)
        )
        selection.clear()
        if (detailOpen.value && detailRecord.value?.hostname === record.hostname) {
          detailRequestGeneration.invalidate()
          detailOpen.value = false
          detailRecord.value = null
        }
      } catch (error) {
        if (scopeOwner.active() && owner.active()) toast.error(errorMessage(error))
      }
    })
  }

  async function refreshHostname(record: SaaSHostname) {
    const key = hostnameKey(record)
    await runBusy(key, async (owner) => {
      try {
        const response = await saasApi.hostname(props.providerId, decodedZone.value, record.hostname, { refresh: true })
        if (!owner.active()) return
        patchHostnameRow(response.data || null)
        toast.success('已刷新')
      } catch (error) {
        if (owner.active()) toast.error(errorMessage(error))
      }
    })
  }

  async function repairHostnameDns(record: SaaSHostname) {
    const scopeOwner = captureScope()
    const key = hostnameKey(record)
    if (!key || isRowBusy(key)) return
    await runBusy(key, async (owner) => {
      if (!scopeOwner.active()) return
      try {
        const response = await saasApi.repairHostnameDns(
          scopeOwner.value.providerId,
          scopeOwner.value.zoneName,
          record.hostname
        )
        if (!scopeOwner.active() || !owner.active()) return
        notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '域名解析已修复')
      } catch (error) {
        if (scopeOwner.active() && owner.active()) toast.error(errorMessage(error))
      }
    })
  }

  async function batchDeleteSelected() {
    const scopeOwner = captureScope()
    let hostnamesList = selectedAvailableRows(pagedHostnames.value, selection.selected.value, hostnameKey, (row) =>
      isRowBusy(hostnameKey(row))
    ).map(hostnameKey)
    if (!hostnamesList.length) {
      toast.warning('请先勾选主机名')
      return
    }
    if (
      !(await confirmDialog({
        title: '批量删除',
        description: `确认删除已选 ${hostnamesList.length} 个自定义主机名？`,
        confirmText: '删除',
        destructive: true,
      }))
    )
      return
    if (!scopeOwner.active()) return
    hostnamesList = hostnamesList.filter((hostname) => !isRowBusy(hostname))
    if (!hostnamesList.length) return
    try {
      await runBatchJob(
        scopeOwner,
        () => saasApi.batchDelete(scopeOwner.value.providerId, scopeOwner.value.zoneName, { hostnames: hostnamesList }),
        '批量删除'
      )
    } catch (error) {
      if (scopeOwner.active()) toast.error(errorMessage(error))
    }
  }

  async function openBatchPreferred() {
    const scopeOwner = captureScope()
    if (!selection.selected.value.length) {
      toast.warning('请先勾选主机名')
      return
    }
    try {
      const res = await preferredDomainApi.list()
      if (!scopeOwner.active()) return
      preferredOptions.value = res.data || []
      if (!preferredOptions.value.length) {
        toast.warning('还没有优选域名，请先在「优选域名」里添加')
        return
      }
      batchPreferredDomain.value = preferredOptions.value[0]?.domain || ''
      batchPreferredError.value = ''
      batchPreferredOpen.value = true
    } catch (error) {
      if (scopeOwner.active()) toast.error(errorMessage(error))
    }
  }

  async function batchUpdatePreferred() {
    if (batchSubmitting.value) return
    const scopeOwner = captureScope()
    let selectedHostnames = selectedAvailableRows(pagedHostnames.value, selection.selected.value, hostnameKey, (row) =>
      isRowBusy(hostnameKey(row))
    ).map(hostnameKey)
    const preferred = batchPreferredDomain.value.trim()
    batchPreferredError.value = preferred ? '' : '请选择优选域名'
    if (batchPreferredError.value) return
    batchSubmitting.value = true
    batchPreferredOpen.value = false
    try {
      if (!scopeOwner.active()) return
      selectedHostnames = selectedHostnames.filter((hostname) => !isRowBusy(hostname))
      if (!selectedHostnames.length) return
      await runBatchJob(
        scopeOwner,
        () =>
          saasApi.batchUpdate(scopeOwner.value.providerId, scopeOwner.value.zoneName, {
            hostnames: selectedHostnames,
            patch: { preferred_domain: preferred, auto_preferred: true },
            auto_sync: true,
          }),
        '批量改优选'
      )
    } catch (error) {
      if (scopeOwner.active()) toast.error(errorMessage(error))
    } finally {
      if (scopeOwner.active()) batchSubmitting.value = false
    }
  }

  watch(
    () => [props.providerId, props.zoneName],
    () => {
      scopeGeneration.invalidate()
      detailRequestGeneration.invalidate()
      detailOpen.value = false
      detailRecord.value = null
      batchPreferredOpen.value = false
      batchSubmitting.value = false
      showPreferred.value = false
      showFallback.value = false
      preferredDialogOwner = null
      resetRowOperations()
      resetEditor()
      resetJobs()
      resetPage()
      selection.clear()
      hostnames.value = []
      void runLoad()
        .then(() => (listActive() ? resumeJobs() : undefined))
        .catch(fail)
    }
  )

  onUnmounted(() => {
    scopeGeneration.invalidate()
    detailRequestGeneration.invalidate()
    batchPreferredOpen.value = false
    batchSubmitting.value = false
    showPreferred.value = false
    showFallback.value = false
    preferredDialogOwner = null
    resetRowOperations()
    resetEditor()
    resetJobs()
  })

  onMounted(() => {
    void loadPreferredOptions()
    void runLoad()
      .then(() => (listActive() ? resumeJobs() : undefined))
      .catch(fail)
  })

  return {
    router,
    jobProgress,
    saving,
    applyingPreferred,
    keyword,
    dialogOpen,
    detailOpen,
    detailLoading,
    detailRefreshing,
    rowBusyKeys,
    detailRecord,
    batchPreferredOpen,
    batchSubmitting,
    batchPreferredDomain,
    batchPreferredError,
    preferredOptions,
    editing,
    formErrors,
    form,
    syncZones,
    syncZonesError,
    preferredOptionsError,
    syncProviders,
    selectedCount,
    originSuggestions,
    showPreferred,
    showFallback,
    openPreferred,
    decodedZone,
    filtered,
    loading,
    refreshing,
    pageSize,
    onRefresh,
    page,
    total,
    pagedHostnames,
    selection,
    preferredDomainOf,
    onPageChange,
    onPageSizeChange,
    onSearch,
    openCreate,
    openEdit,
    openDetails,
    refreshDetailHostname,
    save,
    removeHostname,
    refreshHostname,
    repairHostnameDns,
    applyPreferred: applyPreferredFromDialog,
    batchDeleteSelected,
    openBatchPreferred,
    batchUpdatePreferred,
    loadSyncZones,
    loadPreferredOptions,
  }
}
