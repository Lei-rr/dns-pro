import { computed, reactive, ref, watch } from 'vue'
import { preferredDomainApi, saasApi } from '@/features/saas/api/saas-api'
import type { SaaSHostname, SaaSSyncProvider } from '@/features/saas/model/types'
import { hostnameKey } from '@/features/saas/lib/hostname-key'
import type { DnsZoneOption } from './types'

import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { localPreferenceSideEffectFromData, notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { dnsSideEffectFromData } from '@/shared/lib/side-effects'
import { createScopeGeneration } from '@/shared/lib/scope-generation'

/** 生效的优选域名：与后端 effectivePreferredDomain 同序（顶层优先，回退 custom_metadata） */
export function preferredDomainOf(record: SaaSHostname | null | undefined): string {
  if (!record) return ''
  const metadata = record.custom_metadata as Record<string, unknown> | null | undefined
  // 逐候选先 trim 再判空：纯空白不算已设置，也不该挡住后面的候选（与后端 effectivePreferredDomain 同口径）
  for (const candidate of [record.preferred_domain, metadata?.preferred_domain]) {
    const value = String(candidate ?? '').trim()
    if (value) return value
  }
  return ''
}

export function useSaasHostEditor(options: {
  providerId: () => string
  zoneName: () => string
  loadDnsZones: (providerId: string) => Promise<DnsZoneOption[]>
  reload: () => Promise<void>
  patchHostname: (hostname: SaaSHostname) => void
  closeDetail: () => void
  rowBusy: (key: string) => boolean
  syncProviders: () => SaaSSyncProvider[]
}) {
  const saving = ref(false)
  const dialogOpen = ref(false)
  const editing = ref<SaaSHostname | null>(null)
  const formErrors = ref<FieldErrors>({})
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
  const syncZones = ref<DnsZoneOption[]>([])
  const syncZonesError = ref('')
  const preferredOptions = ref<Array<{ domain: string }>>([])
  const preferredOptionsError = ref('')
  const syncZonesOwnership = createScopeGeneration()
  /** 下拉数据（优选域名）加载的所有权：与表单生命周期、提交彻底分离 */
  const preferredOptionsOwnership = createScopeGeneration()
  const ownership = createScopeGeneration()

  function captureOwner() {
    // claim 会作废上一个 owner：保存中重新打开弹窗时，旧请求不得再改写新表单
    return ownership.claim({})
  }

  /**
   * 新表单会话：作废旧会话的在飞写入，并复位保存态。
   * 旧提交的 finally 只在 owner 有效时复位 saving，会话换代后不再负责它；
   * 若这里不复位，新表单的保存按钮会永久停在加载态。
   */
  function beginFormSession() {
    saving.value = false
    return captureOwner()
  }

  const syncProviders = computed(() => options.syncProviders())
  const selectedSyncProvider = computed(
    () => syncProviders.value.find((provider) => provider.id === form.sync_provider_id) || null
  )
  const selectedSyncTarget = computed(() => {
    if (!selectedSyncProvider.value) return form.sync_target || ''
    return selectedSyncProvider.value.type === 'dnspod' ? 'dnspod' : 'cloudflare_dns'
  })
  const usesGuidedHostname = computed(() => !editing.value && !!form.sync_provider_id)
  const hostnamePreview = computed(() => {
    if (!usesGuidedHostname.value || !form.sync_zone) return ''
    const prefix = form.hostname_prefix.trim().toLowerCase()
    return prefix ? `${prefix}.${form.sync_zone}` : form.sync_zone
  })

  // 已加载过的服务商不重复请求（resetForm 会主动加载一次）
  let loadedSyncProvider = ''
  // 同一服务商的加载已在进行中：resetForm 已显式发起，watch 再触发一次只会让两次响应互相作废
  let pendingSyncProvider = ''

  async function loadSyncZones() {
    const owner = syncZonesOwnership.claim()
    const providerId = form.sync_provider_id
    if (!providerId) {
      syncZones.value = []
      syncZonesError.value = ''
      return
    }
    pendingSyncProvider = providerId
    syncZonesError.value = ''
    syncZones.value = []
    try {
      const zones = await options.loadDnsZones(providerId)
      if (!owner.active() || providerId !== form.sync_provider_id) return
      syncZones.value = zones
      loadedSyncProvider = form.sync_provider_id
      if (!form.sync_zone && syncZones.value[0]?.name) form.sync_zone = String(syncZones.value[0].name)
    } catch {
      if (owner.active()) syncZonesError.value = '同步域名加载失败。'
    } finally {
      if (pendingSyncProvider === providerId) pendingSyncProvider = ''
    }
  }

  watch(
    () => form.sync_provider_id,
    (next) => {
      if (!next || next === loadedSyncProvider || editing.value) return
      form.sync_zone = ''
      if (next === pendingSyncProvider) return
      void loadSyncZones()
    }
  )

  /**
   * 优选域名下拉数据：所有权独立于表单生命周期与提交。
   * 不能与 save 共用 ownership：弹窗里的「重试」会 claim 新 generation、作废正在保存的请求，
   * 让 save 的 finally 永远跳过 saving=false，保存按钮常驻转圈。
   */
  async function loadPreferredOptions() {
    const owner = preferredOptionsOwnership.claim()
    preferredOptionsError.value = ''
    try {
      const response = await preferredDomainApi.list()
      if (!owner.active()) return
      preferredOptions.value = response.data || []
    } catch {
      if (owner.active()) preferredOptionsError.value = '优选域名加载失败。'
    }
  }

  function resetForm() {
    const firstSync = syncProviders.value.find((provider) => provider.type === 'dnspod') || syncProviders.value[0]
    Object.assign(form, {
      hostname: '',
      hostname_prefix: '',
      sync_provider_id: firstSync?.id || '',
      sync_zone: '',
      sync_target: firstSync?.type === 'cloudflare' ? 'cloudflare_dns' : firstSync ? 'dnspod' : '',
      custom_origin_server: '',
      use_custom_origin_server: true,
      preferred_domain: preferredOptionsError.value ? '' : preferredOptions.value[0]?.domain || '__none',
      auto_preferred: true,
      method: 'txt',
      min_tls: '1.2',
      auto_sync: true,
    })
    void loadSyncZones()
  }

  async function openCreate() {
    const owner = beginFormSession()
    editing.value = null
    formErrors.value = {}
    await loadPreferredOptions()
    if (!owner.active()) return
    resetForm()
    dialogOpen.value = true
  }

  function openEdit(record: SaaSHostname) {
    if (options.rowBusy(hostnameKey(record))) return
    options.closeDetail()
    beginFormSession()
    editing.value = record
    formErrors.value = {}
    Object.assign(form, {
      hostname: record.hostname,
      hostname_prefix: '',
      sync_provider_id: String(record.sync_provider_id || record.effective_sync_provider_id || ''),
      sync_zone: String(record.sync_zone || record.effective_sync_zone || ''),
      sync_target: String(record.sync_target || record.effective_sync_target || ''),
      custom_origin_server: String(record.custom_origin_server || ''),
      use_custom_origin_server: !!record.custom_origin_server,
      preferred_domain: preferredDomainOf(record) || '__none',
      auto_preferred: record.auto_preferred !== false,
      method: String(record.ssl?.method || 'txt'),
      min_tls: String(record.ssl?.settings?.min_tls_version || record.ssl?.min_tls_version || '1.2'),
      auto_sync: true,
    })
    void loadPreferredOptions()
    void loadSyncZones()
    dialogOpen.value = true
  }

  async function save() {
    if (saving.value) return
    const owner = captureOwner()
    const hostname = (usesGuidedHostname.value ? hostnamePreview.value : form.hostname).trim()
    const errors: FieldErrors = {}
    if (!hostname) errors.hostname = usesGuidedHostname.value ? '请选择同步域名' : '请填写主机名'
    if (form.use_custom_origin_server && !form.custom_origin_server.trim()) {
      errors.custom_origin_server = '请填写自定义源服务器，或关闭该开关'
    }
    if (form.auto_preferred && (!form.preferred_domain || form.preferred_domain === '__none')) {
      errors.preferred_domain = '开启自动优选时请选择优选域名'
    }
    formErrors.value = errors
    if (Object.keys(errors).length) return

    saving.value = true
    try {
      const preferred = form.preferred_domain === '__none' ? '' : form.preferred_domain
      // 只提交后端实际消费的字段：min_tls/hostname_prefix 属于本地表单状态，ssl 由后端按 method+min_tls_version 组装
      const payload: Record<string, unknown> = {
        method: form.method,
        min_tls_version: form.min_tls,
        auto_preferred: form.auto_preferred,
        preferred_domain: preferred,
        custom_origin_server: form.use_custom_origin_server ? form.custom_origin_server.trim() : '',
      }
      if (editing.value) {
        const response = await saasApi.updateHostname(
          options.providerId(),
          options.zoneName(),
          editing.value.hostname,
          payload,
          { autoSync: form.auto_sync }
        )
        if (!owner.active()) return
        const localPreference = localPreferenceSideEffectFromData(response)
        if (localPreference?.status === 'failed') {
          toast.warning(`主机名已更新，但本地偏好保存失败：${localPreference.message || '未知错误'}`)
        } else {
          notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '主机名已更新')
        }
        dialogOpen.value = false
        if (response.data && localPreference?.status !== 'failed') {
          options.patchHostname(response.data)
          // 更新响应不含 effective_sync_* 等派生字段，静默重载保证行数据完整
          void options.reload()
        } else {
          await options.reload()
        }
      } else {
        // 显式提交同步配置（含清空）：provider 为空表示不启用自动同步
        payload.sync_provider_id = form.sync_provider_id
        payload.sync_zone = form.sync_provider_id ? form.sync_zone : ''
        payload.sync_target = form.sync_provider_id ? selectedSyncTarget.value : ''
        payload.hostname = hostname
        const response = await saasApi.createHostname(options.providerId(), options.zoneName(), payload, {
          autoSync: form.auto_sync && !!payload.sync_target,
        })
        if (!owner.active()) return
        const localPreference = localPreferenceSideEffectFromData(response)
        if (localPreference?.status === 'failed') {
          toast.warning(`主机名已创建，但本地偏好保存失败：${localPreference.message || '未知错误'}`)
        } else {
          notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '主机名已创建')
        }
        dialogOpen.value = false
        await options.reload()
      }
    } catch (error) {
      if (!owner.active()) return
      formErrors.value = { ...formErrors.value, ...serverFieldErrors(error) }
      toast.error(errorMessage(error))
    } finally {
      // 只复位当前会话的保存态：会话换代时由 beginFormSession/openEdit 主动复位，站点切换由 reset 复位
      if (owner.active()) saving.value = false
    }
  }

  function reset() {
    ownership.invalidate()
    syncZonesOwnership.invalidate()
    preferredOptionsOwnership.invalidate()
    dialogOpen.value = false
    editing.value = null
    saving.value = false
  }

  return {
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
    reset,
  }
}
