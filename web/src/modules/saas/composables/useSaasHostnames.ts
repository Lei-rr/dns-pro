import { ref, computed } from 'vue'
import { saasApi } from '../utils/api'
import { dnsApi } from '@/modules/common/dns/api'
import { statusColor, statusLabel, formatDate } from '../utils/saas'
import { providerAvatarColor } from '@/providers/branding'
import { loadProviders } from '@/stores/providers'
import { providerPath } from '@/routes/paths'
import { message } from '@/shared/plugins/antDesignVue'
import { useLatestTask } from '@/shared/composables/useLatestTask'
import { errorMessage } from '@/shared/utils/errors'
import { tablePagination } from '@/shared/utils/pagination'
import type { Provider, SaaSHostname, Zone } from '@/types'

export function useSaasHostnames(
  props: { provider: string; zoneName: string },
  selectedHostname: { value: SaaSHostname | null }
) {
  const hostnames = ref<SaaSHostname[]>([])
  const loading = ref(true)
  const notFound = ref(false)
  const providerMeta = ref<Provider | null>(null)
  const allProviders = ref<Provider[]>([])
  const dnspodZones = ref<Record<string, Zone[]>>({})
  const cloudflareDnsZones = ref<Record<string, Zone[]>>({})
  const listLoadTask = useLatestTask()
  const syncZoneLoadTask = useLatestTask()

  const decodedZoneName = computed(() => decodeURIComponent(props.zoneName))
  const zonesPath = computed(() => providerPath(props.provider))
  const hostnameCloudflareProvider = computed(() => {
    const providerId = providerMeta.value?.cloudflare_provider || ''
    if (!providerId) return null
    return (
      allProviders.value.find(
        (provider) => provider.id === providerId && provider.type === 'cloudflare' && provider.configured
      ) || null
    )
  })
  const dnspodProviders = computed(() =>
    allProviders.value.filter((provider) => provider.type === 'dnspod' && provider.configured)
  )
  const cloudflareProviders = computed(() =>
    hostnameCloudflareProvider.value ? [hostnameCloudflareProvider.value] : []
  )
  const dnspodLinked = computed(() => dnspodProviders.value.length > 0)
  const cloudflareDnsLinked = computed(() => cloudflareProviders.value.length > 0)
  const originSuggestions = computed(() => {
    const seen = new Set<string>()
    const list: Array<{ value: string }> = []
    for (const h of hostnames.value) {
      const v = String(h.custom_origin_server || '').trim()
      if (v !== '' && !seen.has(v)) {
        seen.add(v)
        list.push({ value: v })
      }
    }
    return list
  })
  const columns = computed(() => [
    { title: '自定义主机名', dataIndex: 'hostname', key: 'hostname', width: 240 },
    { title: '证书状态', key: 'ssl_status', width: 100 },
    { title: '到期日期', key: 'expires_on', width: 110 },
    { title: '主机名状态', key: 'status', width: 100 },
    { title: '源服务器', key: 'custom_origin_server', width: 200 },
    { title: '优选域名', key: 'preferred_domain', width: 200 },
    { title: '操作', key: 'actions', width: 140, align: 'right' },
  ])
  const pagination = computed(() => tablePagination())

  function hostnameAvatar(hostname: string) {
    return (String(hostname || '').match(/[a-z0-9]/i)?.[0] || '#').toUpperCase()
  }
  function hostnameAvatarColor() {
    return providerAvatarColor('saas')
  }
  function hostnameRowKey(record: SaaSHostname) {
    return String(record.id || record.hostname || '')
  }

  function resetHostnamesState() {
    hostnames.value = []
    notFound.value = false
    providerMeta.value = null
    allProviders.value = []
    dnspodZones.value = {}
    cloudflareDnsZones.value = {}
  }

  async function loadSyncZones(requestToken: number) {
    const zoneRequestToken = syncZoneLoadTask.next()

    try {
      const [dnspod, cloudflareDns] = await Promise.all([
        loadZonesForProviders(dnspodProviders.value),
        loadZonesForProviders(cloudflareProviders.value),
      ])

      if (!listLoadTask.isCurrent(requestToken) || !syncZoneLoadTask.isCurrent(zoneRequestToken)) return
      dnspodZones.value = dnspod
      cloudflareDnsZones.value = cloudflareDns
    } catch {
      if (!listLoadTask.isCurrent(requestToken) || !syncZoneLoadTask.isCurrent(zoneRequestToken)) return
      dnspodZones.value = {}
      cloudflareDnsZones.value = {}
    }
  }

  async function loadZonesForProvider(providerId: string) {
    const zones: Zone[] = []
    let page = 1

    while (true) {
      const response = await dnsApi.zones(providerId, { page, per_page: 100, refresh: page === 1 })
      zones.push(...response.data)
      const totalPages = Number(response.meta?.total_pages || 1)
      if (page >= totalPages) break
      page += 1
    }

    return zones
  }

  async function loadZonesForProviders(providers: Provider[]) {
    const map: Record<string, Zone[]> = {}
    for (const provider of providers || []) {
      map[provider.id] = await loadZonesForProvider(provider.id)
    }
    return map
  }

  function syncSelectedHostnameFromList() {
    if (!selectedHostname.value) return
    const selectedId = selectedHostname.value.id
    const selectedName = String(selectedHostname.value.hostname || '').toLowerCase()
    const updated = hostnames.value.find(
      (item) =>
        (selectedId && item.id === selectedId) || String(item.hostname || '').toLowerCase() === selectedName
    )
    if (!updated) return

    selectedHostname.value = {
      ...selectedHostname.value,
      ...updated,
      ssl: {
        ...(selectedHostname.value.ssl || {}),
        ...(updated.ssl || {}),
      },
    }
  }

  async function load(options: Record<string, unknown> = {}) {
    const requestToken = listLoadTask.next()
    loading.value = true
    try {
      notFound.value = false
      if (!providerMeta.value) {
        const providers = await loadProviders()
        if (!listLoadTask.isCurrent(requestToken)) return
        allProviders.value = providers || []
        providerMeta.value = providers.find((p) => p.id === props.provider) || null
        await loadSyncZones(requestToken)
      }
      if (!listLoadTask.isCurrent(requestToken)) return
      const response = await saasApi.hostnames(props.provider, decodedZoneName.value, {
        page: 1,
        per_page: 100,
        ...options,
      })
      if (!listLoadTask.isCurrent(requestToken)) return
      hostnames.value = response.data
      syncSelectedHostnameFromList()
    } catch (error) {
      if (!listLoadTask.isCurrent(requestToken)) return
      const e = error as { status?: number; code?: string }
      if (Number(e.status) === 404 || e.code === 'cloudflare_zone_not_found') {
        hostnames.value = []
        notFound.value = true
        return
      }
      message.error(errorMessage(error))
    } finally {
      if (listLoadTask.isCurrent(requestToken)) loading.value = false
    }
  }

  async function handleRefresh() {
    await load({ refresh: true })
    message.success('已刷新')
  }

  return {
    hostnames,
    loading,
    notFound,
    providerMeta,
    allProviders,
    dnspodZones,
    cloudflareDnsZones,
    decodedZoneName,
    zonesPath,
    hostnameCloudflareProvider,
    dnspodProviders,
    cloudflareProviders,
    dnspodLinked,
    cloudflareDnsLinked,
    originSuggestions,
    columns,
    pagination,
    hostnameAvatar,
    hostnameAvatarColor,
    hostnameRowKey,
    resetHostnamesState,
    load,
    handleRefresh,
    syncSelectedHostnameFromList,
    statusColor,
    statusLabel,
    formatDate,
  }
}
