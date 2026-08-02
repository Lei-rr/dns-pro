import { computed, reactive, ref, watch } from 'vue'
import { preferredDomainApi, saasApi } from '@/features/saas/api/saas-api'
import type { SaaSHostname, SaaSSyncProvider } from '@/features/saas/model/types'
import type { DnsZoneOption } from './types'

import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { serverFieldErrors, type FieldErrors } from '@/shared/lib/field-errors'
import { localPreferenceSideEffectFromData, notifyDnsSideEffect } from '@/shared/lib/side-effects'
import { dnsSideEffectFromData } from '@/shared/lib/dns-side-effects'
import { createScopeGeneration, type GenerationOwner } from '@/shared/lib/scope-generation'

export function preferredDomainOf(record: SaaSHostname | null | undefined): string {
  if (!record) return ''
  const metadata = record.custom_metadata as Record<string, unknown> | null | undefined
  return String(metadata?.preferred_domain || record.preferred_domain || '').trim()
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
  const loadingSyncZones = ref(false)
  const syncZonesError = ref('')
  const preferredOptions = ref<Array<{ domain: string }>>([])
  const preferredOptionsError = ref('')
  const syncZonesOwnership = createScopeGeneration()
  const ownership = createScopeGeneration()

  function captureOwner() {
    return ownership.capture({})
  }

  function active(owner: GenerationOwner) {
    return owner.active()
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

  async function loadSyncZones() {
    const owner = syncZonesOwnership.claim()
    const providerId = form.sync_provider_id
    if (!providerId) {
      syncZones.value = []
      syncZonesError.value = ''
      loadingSyncZones.value = false
      return
    }
    loadingSyncZones.value = true
    syncZonesError.value = ''
    syncZones.value = []
    try {
      const zones = await options.loadDnsZones(providerId)
      if (!owner.active() || providerId !== form.sync_provider_id) return
      syncZones.value = zones
      if (!form.sync_zone && syncZones.value[0]?.name) form.sync_zone = String(syncZones.value[0].name)
    } catch {
      if (owner.active()) syncZonesError.value = '同步域名加载失败。'
    } finally {
      if (owner.active()) loadingSyncZones.value = false
    }
  }

  watch(
    () => form.sync_provider_id,
    (next, previous) => {
      if (!next || next === previous || editing.value) return
      form.sync_zone = ''
      void loadSyncZones()
    }
  )

  async function loadPreferredOptions(owner = captureOwner()) {
    preferredOptionsError.value = ''
    try {
      const response = await preferredDomainApi.list()
      if (!active(owner)) return
      preferredOptions.value = response.data || []
    } catch {
      if (active(owner)) preferredOptionsError.value = '优选域名加载失败。'
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
    const owner = captureOwner()
    editing.value = null
    formErrors.value = {}
    await loadPreferredOptions(owner)
    if (!active(owner)) return
    resetForm()
    if (active(owner)) dialogOpen.value = true
  }

  function openEdit(record: SaaSHostname) {
    if (options.rowBusy(String(record.hostname || record.id || ''))) return
    options.closeDetail()
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
      const payload: Record<string, unknown> = {
        method: form.method,
        min_tls: form.min_tls,
        min_tls_version: form.min_tls,
        auto_preferred: form.auto_preferred,
        preferred_domain: preferred || undefined,
        custom_origin_server: form.use_custom_origin_server ? form.custom_origin_server.trim() : '',
        ssl: { method: form.method, settings: { min_tls_version: form.min_tls } },
      }
      if (editing.value) {
        const response = await saasApi.updateHostname(
          options.providerId(),
          options.zoneName(),
          editing.value.hostname,
          payload,
          { autoSync: form.auto_sync }
        )
        if (!active(owner)) return
        const localPreference = localPreferenceSideEffectFromData(response)
        if (localPreference?.status === 'failed') {
          toast.warning(`主机名已更新，但本地偏好保存失败：${localPreference.message || '未知错误'}`)
        } else {
          notifyDnsSideEffect(dnsSideEffectFromData(response, 'sync'), '主机名已更新')
        }
        dialogOpen.value = false
        if (response.data && localPreference?.status !== 'failed') options.patchHostname(response.data)
        else await options.reload()
      } else {
        if (form.sync_provider_id) {
          payload.sync_provider_id = form.sync_provider_id
          payload.sync_zone = form.sync_zone
          payload.sync_target = selectedSyncTarget.value
        }
        payload.hostname = hostname
        const response = await saasApi.createHostname(options.providerId(), options.zoneName(), payload, {
          autoSync: form.auto_sync && !!payload.sync_target,
        })
        if (!active(owner)) return
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
      if (!active(owner)) return
      formErrors.value = { ...formErrors.value, ...serverFieldErrors(error) }
      toast.error(errorMessage(error))
    } finally {
      if (active(owner)) saving.value = false
    }
  }

  function reset() {
    ownership.invalidate()
    syncZonesOwnership.invalidate()
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
