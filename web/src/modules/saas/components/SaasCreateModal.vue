<template>
  <a-modal
    :open="open"
    @update:open="emitOpen"
    :title="title"
    :confirm-loading="confirmLoading"
    :ok-button-props="{ disabled: !canSubmit }"
    :ok-text="okText"
    cancel-text="取消"
    @ok="submit"
  >
    <a-form layout="vertical">
      <a-typography-title :level="5">主机名设置</a-typography-title>
      <a-form-item v-if="editing || !usesGuidedHostname" label="主机名" required>
        <a-input v-model:value="form.hostname" placeholder="app.example.com" :disabled="editing" />
      </a-form-item>
      <template v-else>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="同步服务商">
              <a-select v-model:value="form.sync_provider_id" :options="syncProviderOptions" placeholder="选择服务商" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="主机名前缀">
              <a-input v-model:value="form.hostname_prefix" placeholder="如 app；留空表示根域名" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="同步域名">
              <a-select
                v-model:value="form.sync_zone"
                :options="activeSyncZones.map((zone) => ({ label: zone.name, value: zone.name }))"
                placeholder="选择域名"
                show-search
                option-filter-prop="label"
              />
            </a-form-item>
          </a-col>
        </a-row>
      </template>

      <a-typography-title :level="5">证书与回源</a-typography-title>
      <a-row :gutter="12">
        <a-col :span="12">
          <a-form-item label="DCV 认证">
            <a-select v-model:value="form.method">
              <a-select-option value="txt">TXT 验证（推荐）</a-select-option>
              <a-select-option value="http">HTTP 验证</a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="最低 TLS 版本">
            <a-select v-model:value="form.min_tls_version">
              <a-select-option value="1.0">TLS 1.0（默认）</a-select-option>
              <a-select-option value="1.1">TLS 1.1</a-select-option>
              <a-select-option value="1.2">TLS 1.2</a-select-option>
              <a-select-option value="1.3">TLS 1.3</a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="证书类型">
        <a-typography-text>由 Cloudflare 提供</a-typography-text>
      </a-form-item>
      <a-form-item
        :validate-status="originRequired ? 'error' : ''"
        :help="form.use_custom_origin_server ? '' : '关闭后使用默认回退源'"
      >
        <a-space>
          <a-typography-title :level="5" style="margin: 0">自定义源服务器</a-typography-title>
          <a-switch v-model:checked="form.use_custom_origin_server" size="small" />
        </a-space>
        <a-auto-complete
          v-if="form.use_custom_origin_server"
          v-model:value="form.custom_origin_server"
          :options="originSuggestions"
          :filter-option="filterOption"
          placeholder="输入或从已用源服务器选择，如 origin.example.com"
          style="margin-top: 12px; width: 100%"
        />
      </a-form-item>

      <template v-if="selectedSyncTarget === 'dnspod' || selectedSyncTarget === 'cloudflare_dns'">
        <a-form-item>
          <a-space>
            <a-typography-title :level="5" style="margin: 0">自动优选</a-typography-title>
            <a-switch v-model:checked="form.autoPreferred" size="small" />
          </a-space>
        </a-form-item>
        <a-form-item
          v-if="form.autoPreferred && (selectedSyncTarget === 'dnspod' || selectedSyncTarget === 'cloudflare_dns')"
          :label="selectedSyncTarget === 'cloudflare_dns' ? '优选域名' : '境内优选 CNAME'"
        >
          <a-select
            v-model:value="form.preferred_domain"
            allow-clear
            :placeholder="
              selectedSyncTarget === 'cloudflare_dns'
                ? '可选；选择后主业务 CNAME 直接指向该优选域名'
                : '可选；选择后会同步一条 CNAME（线路：境内）'
            "
          >
            <a-select-option v-for="opt in preferredOptions" :key="opt.value" :value="opt.value">{{
              opt.label
            }}</a-select-option>
          </a-select>
        </a-form-item>
      </template>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { filterOption } from '../utils/saas'
import type { Provider, SaaSHostname, Zone } from '@/types'

const props = defineProps<{
  open?: boolean
  title?: string
  okText?: string
  confirmLoading?: boolean
  dnspodLinked?: boolean
  cloudflareDnsLinked?: boolean
  dnspodProviders?: Provider[]
  cloudflareDnsProviders?: Provider[]
  dnspodZones?: Record<string, Zone[]>
  cloudflareDnsZones?: Record<string, Zone[]>
  originSuggestions?: Array<{ value: string }>
  preferredDomains?: Array<{ domain: string }>
  initialValue?: SaaSHostname | null
  editing?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', form: Record<string, unknown>): void
}>()

const form = ref<Record<string, unknown>>({})

watch(
  () => props.open,
  (value) => {
    if (value) form.value = defaultForm()
  }
)
watch(
  () => props.dnspodZones,
  () => ensureSyncDefaults()
)
watch(
  () => props.cloudflareDnsZones,
  () => ensureSyncDefaults()
)
// Only auto-fill sync zone when creating. Editing must keep the host's stored DNS linkage.
watch(
  () => String(form.value.sync_provider_id || ''),
  (value, previous) => {
    if (!value || props.editing || value === previous) return
    form.value.sync_zone = defaultSyncZone(value)
  }
)
watch(
  () => Boolean(form.value.autoPreferred),
  (value) => {
    if (value && !form.value.preferred_domain) {
      form.value.preferred_domain = firstPreferred()
    }
  }
)
watch(
  () => props.preferredDomains,
  () => {
    if (props.open && form.value.autoPreferred && !form.value.preferred_domain) {
      form.value.preferred_domain = firstPreferred()
    }
  }
)

const syncProviderOptions = computed(() => {
  return [
    ...(props.cloudflareDnsProviders || []).map((provider) => ({
      label: `${provider.name}（Cloudflare）`,
      value: provider.id,
    })),
    ...(props.dnspodProviders || []).map((provider) => ({
      label: `${provider.name}（DNSPod）`,
      value: provider.id,
    })),
  ]
})
const selectedSyncTarget = computed(() => {
  const providerId = String(form.value.sync_provider_id || '')
  if ((props.cloudflareDnsProviders || []).some((provider) => provider.id === providerId)) return 'cloudflare_dns'
  if ((props.dnspodProviders || []).some((provider) => provider.id === providerId)) return 'dnspod'
  // Fallback for edit mode when provider lists are not ready yet.
  const current = props.initialValue
  const existingTarget = String(current?.sync_target || (current as any)?.effective_sync_target || '').trim()
  if (existingTarget === 'dnspod' || existingTarget === 'cloudflare_dns') return existingTarget
  if (providerId === 'dnspod') return 'dnspod'
  if (providerId === 'cloudflare' || providerId.includes('cloudflare')) return 'cloudflare_dns'
  return ''
})
const activeSyncZones = computed(() => {
  if (selectedSyncTarget.value === 'dnspod') return props.dnspodZones?.[form.value.sync_provider_id as string] || []
  if (selectedSyncTarget.value === 'cloudflare_dns')
    return props.cloudflareDnsZones?.[form.value.sync_provider_id as string] || []
  return []
})
const syncPlatformLabel = computed(() => {
  if (selectedSyncTarget.value === 'dnspod') return 'DNSPod'
  if (selectedSyncTarget.value === 'cloudflare_dns') return 'Cloudflare'
  return ''
})
const usesGuidedHostname = computed(() => !props.editing && !!form.value.sync_provider_id)
const hostnamePreview = computed(() => {
  if (!usesGuidedHostname.value || !form.value.sync_zone) return ''
  const prefix = String(form.value.hostname_prefix || '')
    .trim()
    .toLowerCase()
  return prefix ? `${prefix}.${form.value.sync_zone}` : String(form.value.sync_zone)
})
const preferredOptions = computed(() => {
  return (props.preferredDomains || []).map((item) => ({
    value: item.domain,
    label: item.domain,
  }))
})
const hostnameEmpty = computed(
  () => !String(usesGuidedHostname.value ? hostnamePreview.value : form.value.hostname || '').trim()
)
const originRequired = computed(
  () => !!form.value.use_custom_origin_server && !String(form.value.custom_origin_server || '').trim()
)
const preferredRequired = computed(
  () => !!form.value.autoPreferred && !String(form.value.preferred_domain || '').trim()
)
const syncZoneRequired = computed(() => usesGuidedHostname.value && !String(form.value.sync_zone || '').trim())
const canSubmit = computed(
  () => !hostnameEmpty.value && !originRequired.value && !syncZoneRequired.value && !preferredRequired.value
)

function firstPreferred(): string {
  return preferredOptions.value[0]?.value || ''
}
function defaultSyncZone(providerId = ''): string {
  const currentProviderId: string = providerId || String(form.value?.sync_provider_id || '')
  const zones: Zone[] = props.dnspodZones?.[currentProviderId] || props.cloudflareDnsZones?.[currentProviderId] || []
  return zones[0]?.name || ''
}
function defaultSyncProviderId() {
  // Prefer DNSPod for SaaS DNS sync (境内优选 CNAME). Cloudflare DNS is secondary.
  return props.dnspodProviders?.[0]?.id || props.cloudflareDnsProviders?.[0]?.id || ''
}
function ensureSyncDefaults() {
  if (!props.open || props.editing) return
  if (!form.value.sync_provider_id) form.value.sync_provider_id = defaultSyncProviderId()
  if (form.value.sync_provider_id && !form.value.sync_zone)
    form.value.sync_zone = defaultSyncZone(form.value.sync_provider_id as string)
}
function normalizeInitialValue(): Record<string, unknown> {
  const current = props.initialValue || ({} as SaaSHostname)
  const customOriginServer = String(current.custom_origin_server || '').trim()
  const syncProviderId = String(
    current.sync_provider_id || (current as any).effective_sync_provider_id || '',
  ).trim()
  const syncZone = String(current.sync_zone || (current as any).effective_sync_zone || '').trim()

  return {
    hostname: String(current.hostname || '').trim(),
    hostname_prefix: '',
    custom_origin_server: customOriginServer,
    method: String(current.ssl?.method || 'txt').trim() || 'txt',
    min_tls_version: String(current.ssl?.settings?.min_tls_version || '1.0').trim() || '1.0',
    use_custom_origin_server: customOriginServer !== '',
    autoPreferred: Boolean(current.auto_preferred),
    preferred_domain: String(current.custom_metadata?.preferred_domain || '').trim(),
    sync_provider_id: syncProviderId,
    sync_zone: syncZone,
    // Keep existing target so submit/autoSync don't drop DNS linkage during edit.
    sync_target: String(current.sync_target || (current as any).effective_sync_target || '').trim(),
  }
}
function defaultForm(): Record<string, unknown> {
  if (props.editing) return normalizeInitialValue()

  const syncProviderId = defaultSyncProviderId()

  return {
    hostname: '',
    hostname_prefix: '',
    custom_origin_server: '',
    method: 'txt',
    min_tls_version: '1.0',
    use_custom_origin_server: true,
    autoPreferred: true,
    preferred_domain: props.dnspodLinked ? firstPreferred() : '',
    sync_provider_id: syncProviderId,
    sync_zone: defaultSyncZone(syncProviderId),
  }
}
form.value = defaultForm()

function emitOpen(value: boolean) {
  emit('update:open', value)
}
function submit() {
  if (!canSubmit.value) return
  const hostname = usesGuidedHostname.value ? hostnamePreview.value : String(form.value.hostname || '').trim()
  const syncTarget =
    selectedSyncTarget.value ||
    String(form.value.sync_target || props.initialValue?.sync_target || (props.initialValue as any)?.effective_sync_target || '').trim()
  emit('submit', {
    ...form.value,
    sync_target: syncTarget,
    hostname,
  })
}
</script>
