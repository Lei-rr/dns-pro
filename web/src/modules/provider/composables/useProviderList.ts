import { ref, computed } from 'vue'
import { providerSettingsApi } from '@/modules/provider/api/providers'
import { replaceProvidersCache } from '@/stores/providers'
import { message } from '@/shared/plugins/antDesignVue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { errorMessage } from '@/shared/utils/errors'
import type { Provider, ProviderDefinition, ProviderDefinitions } from '@/types'

export function useProviderList() {
  const providers = ref<Provider[]>([])
  const loading = ref(true)
  const providerDefinitions = ref<ProviderDefinitions | null>(null)
  const loadTask = useLatestTask()
  const definitionLoadTask = useLatestTask()

  const dnspodProviders = computed(() =>
    providers.value.filter((provider) => provider.type === 'dnspod' && provider.configured)
  )
  const cloudflareProviders = computed(() =>
    providers.value.filter((provider) => provider.type === 'cloudflare' && provider.configured)
  )
  const providerTypes = computed(() => providerDefinitions.value?.types || [])

  function providerRowKey(provider: Provider) {
    return provider.id
  }

  async function loadProviderDefinitions() {
    const requestToken = definitionLoadTask.next()

    try {
      const definitions = (await providerSettingsApi.providerDefinitions()).data
      if (!definitionLoadTask.isCurrent(requestToken)) return
      providerDefinitions.value = definitions
    } catch {
      if (!definitionLoadTask.isCurrent(requestToken)) return
      providerDefinitions.value = null
    }
  }

  async function load() {
    const requestToken = loadTask.next()
    loading.value = true

    try {
      const list = (await providerSettingsApi.providers()).data
      if (!loadTask.isCurrent(requestToken)) return
      providers.value = list
      replaceProvidersCache(list)
    } catch (error) {
      if (!loadTask.isCurrent(requestToken)) return
      message.error(errorMessage(error))
    } finally {
      if (loadTask.isCurrent(requestToken)) loading.value = false
    }
  }

  function providerDefinition(type: string): ProviderDefinition | null {
    return providerDefinitions.value?.types.find((providerType) => providerType.type === type) || null
  }

  function fieldLabel(field: string) {
    return providerDefinitions.value?.labels?.[field] || field
  }

  function requiredFields(type: string): string[] {
    return providerDefinition(type)?.required || []
  }

  function isProviderSelectField(field: string) {
    return field === 'dnspod_provider' || field === 'cloudflare_provider' || field === 'cloudflare_dns_provider'
  }

  function selectFieldProviders(field: string): Provider[] {
    if (field === 'dnspod_provider') return dnspodProviders.value
    if (field === 'cloudflare_provider' || field === 'cloudflare_dns_provider') return cloudflareProviders.value
    return []
  }

  function selectFieldPlaceholder(field: string) {
    if (field === 'dnspod_provider') return '选择 DNSPod API'
    if (field === 'cloudflare_provider') return '选择 Cloudflare API'
    if (field === 'cloudflare_dns_provider') return '选择 Cloudflare DNS API'
    return '请选择'
  }

  function isSecretField(field: string) {
    return field.includes('key') || field.includes('token')
  }

  function createFields(type = 'dnspod'): string[] {
    return providerDefinition(type)?.fields || []
  }

  function linkedProviderLabel(providerId: string) {
    const linked = providers.value.find((provider) => provider.id === providerId)
    if (!linked) return providerId || '未配置'
    return `${linked.name}（${linked.id}）`
  }

  function configItems(provider: Provider): Array<{ key: string; value: string; color: string }> {
    if (provider.type === 'dnspod' || provider.type === 'cloudflare') {
      return [
        {
          key: 'api',
          value: provider.configured ? '已配置' : '未配置',
          color: provider.configured ? 'green' : 'default',
        },
      ]
    }

    const items: Array<{ key: string; value: string; color: string }> = []

    if (provider.type === 'edgeone' && provider.dnspod_provider) {
      items.push({
        key: 'edgeone-dnspod',
        value: linkedProviderLabel(provider.dnspod_provider),
        color: 'blue',
      })
    }

    if (provider.type === 'saas' && provider.cloudflare_provider) {
      items.push({
        key: 'saas-cloudflare',
        value: `SaaS：${linkedProviderLabel(provider.cloudflare_provider)}`,
        color: 'orange',
      })
    }

    if (provider.type === 'saas' && provider.dnspod_provider) {
      items.push({
        key: 'saas-dnspod-sync',
        value: `DNSPod 同步：${linkedProviderLabel(provider.dnspod_provider)}`,
        color: 'blue',
      })
    }

    if (provider.type === 'saas' && provider.cloudflare_dns_provider) {
      items.push({
        key: 'saas-cloudflare-dns-sync',
        value: `Cloudflare DNS 同步：${linkedProviderLabel(provider.cloudflare_dns_provider)}`,
        color: 'cyan',
      })
    }

    if (provider.type === 'cloudflared' && provider.cloudflare_provider) {
      items.push({
        key: 'cloudflared-cloudflare',
        value: linkedProviderLabel(provider.cloudflare_provider),
        color: 'orange',
      })
    }

    return items.length
      ? items
      : [
          {
            key: 'api',
            value: provider.configured ? '已配置' : '未配置',
            color: provider.configured ? 'green' : 'default',
          },
        ]
  }

  return {
    providers,
    loading,
    providerDefinitions,
    dnspodProviders,
    cloudflareProviders,
    providerTypes,
    providerRowKey,
    loadProviderDefinitions,
    load,
    providerDefinition,
    fieldLabel,
    requiredFields,
    isProviderSelectField,
    selectFieldProviders,
    selectFieldPlaceholder,
    isSecretField,
    createFields,
    configItems,
  }
}
