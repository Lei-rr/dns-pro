<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCachedProvider, loadProviders, useProviderStore } from '@/features/providers'
import { dnsApi, RecordsPanel, ZonesPanel } from '@/features/dns'
import { SaasHostsPanel, type SaaSSyncProvider } from '@/features/saas'
import { AccelerationDomainsPanel, EdgeOneZonesPanel } from '@/features/edge-one'
import { TunnelDetailPanel, TunnelsPanel } from '@/features/tunnels'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

const props = defineProps<{ child?: boolean }>()
const route = useRoute()
const router = useRouter()

const providerId = computed(() => String(route.params.provider || ''))
const second = computed(() => String(route.params.second || ''))
const provider = computed(() => getCachedProvider(providerId.value))
const providerType = computed(() => provider.value?.type || '')
const edgeOneDnspodLinked = computed<boolean>(() => {
  const current = provider.value
  if (current?.type !== 'edgeone') return false
  return Boolean(String(current.dnspod_provider || current.fields?.dnspod_provider || '').trim())
})
const syncProviders = computed<SaaSSyncProvider[]>(() =>
  (useProviderStore().providers || []).flatMap((item) =>
    item.type === 'dnspod' || item.type === 'cloudflare' ? [{ id: item.id, type: item.type, name: item.name }] : []
  )
)

async function loadDnsZones(providerId: string) {
  const target = getCachedProvider(providerId)
  if (!target || (target.type !== 'dnspod' && target.type !== 'cloudflare')) return []
  return (await dnsApi.zones({ id: target.id, type: target.type, name: target.name })).data
}

const page = computed((): { component: Component | null; pageProps: Record<string, unknown> } => {
  const type = providerType.value
  const id = providerId.value
  if (!type || !id) return { component: null, pageProps: {} }

  if (props.child) {
    if (type === 'dnspod' || type === 'cloudflare') {
      return { component: RecordsPanel, pageProps: { provider: provider.value, zoneId: second.value } }
    }
    if (type === 'saas') {
      return {
        component: SaasHostsPanel,
        pageProps: { providerId: id, zoneName: second.value, loadDnsZones, syncProviders: syncProviders.value },
      }
    }
    if (type === 'edgeone') {
      return {
        component: AccelerationDomainsPanel,
        pageProps: { providerId: id, zoneId: second.value, dnspodLinked: edgeOneDnspodLinked.value },
      }
    }
    if (type === 'cloudflared') {
      return { component: TunnelDetailPanel, pageProps: { providerId: id, tunnelId: second.value } }
    }
    return { component: null, pageProps: {} }
  }

  if (type === 'dnspod' || type === 'cloudflare' || type === 'saas') {
    return { component: ZonesPanel, pageProps: { provider: provider.value } }
  }
  if (type === 'edgeone') {
    return { component: EdgeOneZonesPanel, pageProps: { providerId: id } }
  }
  if (type === 'cloudflared') {
    return { component: TunnelsPanel, pageProps: { providerId: id } }
  }
  return { component: null, pageProps: {} }
})

onMounted(async () => {
  try {
    if (!getCachedProvider(providerId.value)) await loadProviders({ force: true })
    if (!getCachedProvider(providerId.value)) {
      toast.warning('服务商未配置')
      router.replace('/')
    }
  } catch (error) {
    toast.error(errorMessage(error))
  }
})
</script>

<template>
  <component :is="page.component" v-if="page.component" v-bind="page.pageProps" />
  <div v-else class="py-16 text-center">
    <div class="text-lg font-medium">{{ provider?.name || providerId }}</div>
    <p class="text-muted-foreground mt-2 text-sm">当前服务商类型暂未接入。</p>
  </div>
</template>
