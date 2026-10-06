import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { preferredDomainApi, saasApi } from '@/features/saas/api/saas-api'
import type { SaaSHostname, SaaSSyncProvider } from '@/features/saas/model/types'
import { confirmDeleteWithSkipCleanup, confirmDialog } from '@/shared/ui/confirm'
import { useSaasHostJobs } from './use-saas-host-jobs'
import { preferredDomainOf, useSaasHostEditor } from './use-saas-host-editor'
import { hostnameKey } from '@/features/saas/lib/hostname-key'
import type { DnsZoneOption } from '../model/types'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { useResourceQuery } from '@/shared/query'
import { useLocalPagination } from '@/shared/lib/use-local-pagination'
import { useRowBusy } from '@/shared/lib/row-busy'
import { selectedAvailableRows, useRowSelection } from '@/shared/lib/row-selection'
import { notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { dnsSideEffectFromData } from '@/shared/lib/side-effects'
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

  // route 参数已由 vue-router 解码（畸形编码会回退原值），这里不再二次解码，避免含 '%' 的站点名抛 URIError
  const routeZoneName = computed(() => props.zoneName)
  const hostnamesQuery = useResourceQuery<SaaSHostname[]>({
    key: () => ['saas', 'hostnames', props.providerId, routeZoneName.value],
    queryFn: async ({ refresh, signal }) =>
      (await saasApi.hostnames(props.providerId, routeZoneName.value, { refresh, signal })).data || [],
    pageSizeScope: 'saas-hosts',
  })
  /**
   * 视图镜像：保留面板内的局部 patch 反馈，写后统一由 invalidate 收敛到服务端真相。
   * 必须浅拷贝数组：TanStack 的 query.data 是深 readonly 代理，把代理数组直接当镜像，
   * 下面的 `hostnames.value[idx] = row` 会静默失效（Vue 只打警告，行不更新）。
   */
  const hostnames = ref<SaaSHostname[]>([])
  watch(hostnamesQuery.data, (data) => {
    if (data) hostnames.value = data.slice()
  })
  const keyword = ref('')
  const detailOpen = ref(false)
  const detailLoading = ref(false)
  const detailRefreshing = ref(false)
  const { busyKeys: rowBusyKeys, isBusy: isRowBusy, runBusy, reset: resetRowOperations } = useRowBusy()
  const detailRequestGeneration = createScopeGeneration()
  /**
   * 详情「刷新」自己的所有权：与 openDetails 的加载所有权分离。
   * 共用会让后发起的操作 claim 掉先发起的 owner，先发起的一方 finally 永远跳过复位，
   * detailLoading / detailRefreshing 卡在 true。
   */
  const detailRefreshGeneration = createScopeGeneration()
  const scopeGeneration = createScopeGeneration()
  const detailRecord = ref<SaaSHostname | null>(null)
  const batchPreferredOpen = ref(false)
  const batchSubmitting = ref(false)
  const batchPreferredDomain = ref('')
  const batchPreferredError = ref('')
  /** 批量改优选的附加开关：默认关闭，避免静默打开各主机名的「自动优选」 */
  const batchAutoPreferred = ref(false)

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

  function captureScope(): ScopeOwner<SaasScope> {
    return scopeGeneration.capture({ providerId: props.providerId, zoneName: routeZoneName.value })
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
  const loading = hostnamesQuery.loading
  const refreshing = hostnamesQuery.refreshing
  const pageSize = hostnamesQuery.pageSize
  const setPageSize = hostnamesQuery.setPageSize
  const runLoad = () => hostnamesQuery.invalidate()
  const { page, total, pagedItems: pagedHostnames, resetPage } = useLocalPagination(filtered, pageSize)
  /** 服务商下的主机名总数（不受搜索过滤影响） */
  const hostTotal = computed(() => hostnames.value.length)
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
    zoneName: () => routeZoneName.value,
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
    detailRefreshGeneration.invalidate()
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
    zoneName: () => routeZoneName.value,
    loadDnsZones: props.loadDnsZones,
    reload: () => runLoad(),
    patchHostname: patchHostnameRow,
    closeDetail: () => {
      detailRequestGeneration.invalidate()
      detailRefreshGeneration.invalidate()
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
    return JSON.stringify([props.providerId, routeZoneName.value, String(record.hostname || '')])
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
      const response = await saasApi.hostname(props.providerId, routeZoneName.value, record.hostname)
      if (!isCurrentDetail(owner, identity)) return
      // 载荷非空由 unwrapItem 的守卫保证（空体/异形响应在 API 层抛错）：不需要再靠 truthy 拦截
      detailRecord.value = response.data
      patchHostnameRow(response.data)
    } catch (error) {
      if (isCurrentDetail(owner, identity)) toast.error(errorMessage(error))
    } finally {
      if (isCurrentDetail(owner, identity)) detailLoading.value = false
    }
  }

  async function refreshDetailHostname(record: SaaSHostname) {
    const key = hostnameKey(record)
    await runBusy(key, async (rowOwner) => {
      // 刷新不占用 openDetails 的所有权：两者并发时各自的 in-flight 状态都能正常收尾
      const detailOwner = detailRefreshGeneration.claim()
      const identity = detailIdentity(record)
      detailRefreshing.value = true
      try {
        // reconcile：刷新远端状态，并在激活后清理所有权验证 TXT
        const response = await saasApi.reconcileHostname(props.providerId, routeZoneName.value, record.hostname)
        if (!rowOwner.active() || !isCurrentDetail(detailOwner, identity)) return
        if (response.data) patchHostnameRow(response.data)
        toast.success('已刷新状态')
      } catch (error) {
        if (rowOwner.active() && isCurrentDetail(detailOwner, identity)) toast.error(errorMessage(error))
      } finally {
        // 刷新态只由刷新自己复位：弹窗换代不能让它停在加载中
        if (detailOwner.active()) detailRefreshing.value = false
      }
    })
  }

  async function removeHostname(record: SaaSHostname) {
    const scopeOwner = captureScope()
    const hostname = record.hostname
    const key = hostnameKey(record)
    if (!key || isRowBusy(key)) return
    // 删除对话框自带「跳过 DNS 清理」勾选：后端 auto_cleanup=false 一直可用，界面必须能选到
    const deletion = await confirmDeleteWithSkipCleanup(hostname)
    if (!deletion.confirmed || !scopeOwner.active()) return
    const skipCleanup = deletion.checked
    await runBusy(key, async (owner) => {
      if (!scopeOwner.active()) return
      try {
        const response = await saasApi.deleteHostname(
          scopeOwner.value.providerId,
          scopeOwner.value.zoneName,
          hostname,
          { skipCleanup }
        )
        if (!scopeOwner.active() || !owner.active()) return
        notifyDnsSideEffect(dnsSideEffectFromData(response, 'cleanup'), '已删除')
        await hostnamesQuery.invalidate()
        selection.clear()
        if (detailOpen.value && detailRecord.value?.hostname === record.hostname) {
          detailRequestGeneration.invalidate()
          detailRefreshGeneration.invalidate()
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
        const response = await saasApi.hostname(props.providerId, routeZoneName.value, record.hostname, {
          refresh: true,
        })
        if (!owner.active()) return
        patchHostnameRow(response.data)
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

  /** 已勾选且当前不忙的主机名：批量删除与批量改优选共用的输入 */
  function selectedAvailableHostnames() {
    return selectedAvailableRows(pagedHostnames.value, selection.selected.value, hostnameKey, (row) =>
      isRowBusy(hostnameKey(row))
    ).map(hostnameKey)
  }

  async function batchDeleteSelected() {
    const scopeOwner = captureScope()
    let hostnamesList = selectedAvailableHostnames()
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
      batchAutoPreferred.value = false
      batchPreferredOpen.value = true
    } catch (error) {
      if (scopeOwner.active()) toast.error(errorMessage(error))
    }
  }

  async function batchUpdatePreferred() {
    if (batchSubmitting.value) return
    const scopeOwner = captureScope()
    let selectedHostnames = selectedAvailableHostnames()
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
            // 未勾选时不下发 auto_preferred，让后端沿用各主机名既有偏好
            patch: { preferred_domain: preferred, ...(batchAutoPreferred.value ? { auto_preferred: true } : {}) },
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
      detailRefreshGeneration.invalidate()
      detailOpen.value = false
      detailRecord.value = null
      batchPreferredOpen.value = false
      batchSubmitting.value = false
      batchAutoPreferred.value = false
      showPreferred.value = false
      showFallback.value = false
      preferredDialogOwner = null
      resetRowOperations()
      resetEditor()
      resetJobs()
      // 搜索词属于上一个站点：不清理会让新列表被旧关键词过滤成空表
      keyword.value = ''
      resetPage()
      selection.clear()
      hostnames.value = []
      void resumeJobs()
    }
  )

  onUnmounted(() => {
    scopeGeneration.invalidate()
    detailRequestGeneration.invalidate()
    detailRefreshGeneration.invalidate()
    batchPreferredOpen.value = false
    batchSubmitting.value = false
    batchAutoPreferred.value = false
    showPreferred.value = false
    showFallback.value = false
    preferredDialogOwner = null
    resetRowOperations()
    resetEditor()
    resetJobs()
  })

  onMounted(() => {
    void loadPreferredOptions()
    void resumeJobs()
  })

  /**
   * 按职责分组返回。组是普通对象，直接持有同一批 ref / computed / 函数引用，
   * 不做 reactive()/toRefs 包装、不提前 .value 解包，响应式语义与原先的平铺返回完全一致。
   * 消费侧注意：编译器只为顶层标识符解包 ref，`group.field` 是成员表达式，
   * 组内 ref 必须显式 `.value`（写成 `v-model="group.field"` 会退化成裸赋值，把 ref 覆盖成原始值）。
   */
  return {
    // 面板级上下文：与具体功能无关，任何一节改动都不必碰
    router,
    routeZoneName,
    // 列表数据与分页：搜索、镜像列表、本地分页、刷新
    list: {
      loading,
      refreshing,
      pageSize,
      page,
      total,
      hostTotal,
      pagedHostnames,
      keyword,
      onRefresh: () => hostnamesQuery.refresh(),
      onPageChange,
      onPageSizeChange,
      onSearch,
    },
    // 行级状态与行操作：共用 hostnameKey 惰性令牌，均受 rowBusyKeys 门控
    rows: {
      rowBusyKeys,
      refreshHostname,
      removeHostname,
      repairHostnameDns,
    },
    // 详情抽屉：打开/刷新各自持有所有权，避免并发收尾互相作废
    detail: {
      detailOpen,
      detailLoading,
      detailRefreshing,
      detailRecord,
      openDetails,
      refreshDetailHostname,
    },
    // 创建/编辑表单：表单会话、表单级下拉数据（同步域名与优选域名同源同构）
    editor: {
      dialogOpen,
      editing,
      form,
      formErrors,
      saving,
      originSuggestions,
      preferredOptions,
      preferredOptionsError,
      syncZones,
      syncZonesError,
      syncProviders,
      openCreate,
      openEdit,
      save,
      loadSyncZones,
      loadPreferredOptions,
    },
    // 批量与优选：勾选模型、任务进度、批量改优选/删除、优选域名应用到列表
    batch: {
      selection,
      selectedCount,
      jobProgress,
      applyingPreferred,
      batchPreferredOpen,
      batchSubmitting,
      batchPreferredDomain,
      batchPreferredError,
      batchAutoPreferred,
      preferredDomainOf,
      showPreferred,
      showFallback,
      openPreferred,
      applyPreferred: applyPreferredFromDialog,
      batchDeleteSelected,
      openBatchPreferred,
      batchUpdatePreferred,
    },
  }
}
