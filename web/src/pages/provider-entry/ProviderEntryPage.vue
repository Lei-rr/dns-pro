<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCachedProviderAny, loadProviders, useProvidersQuery } from '@/features/providers'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'
import { Button } from '@/shared/ui/button'
import type { ProviderPageProps } from './provider-page-props'
import ZonesListPage from '../zones/ZonesListPage.vue'
import DnsRecordsPage from '../dns/DnsRecordsPage.vue'
import SaasHostsPage from '../saas/SaasHostsPage.vue'
import EdgeOneZonesPage from '../edge-one/EdgeOneZonesPage.vue'
import EdgeOneDomainsPage from '../edge-one/EdgeOneDomainsPage.vue'
import TunnelsPage from '../tunnels/TunnelsPage.vue'
import TunnelDetailPage from '../tunnels/TunnelDetailPage.vue'

const props = defineProps<{ child?: boolean }>()
const route = useRoute()
const router = useRouter()
const { allProviders } = useProvidersQuery()

const providerId = computed(() => String(route.params.provider || ''))
const second = computed(() => String(route.params.second || ''))
const current = computed(() => allProviders.value.find((item) => item.id === providerId.value) || null)
/** 存在但未配置完整的服务商：展示明确状态而不是空白页 */
const unconfigured = computed(() => (current.value ? null : getCachedProviderAny(providerId.value)))

/** 声明式页面注册表：provider.type → { 列表页, 详情页 }，取代原来的 if 链分派。 */
const PAGE_REGISTRY: Record<string, { list: Component; detail: Component }> = {
  dnspod: { list: ZonesListPage, detail: DnsRecordsPage },
  cloudflare: { list: ZonesListPage, detail: DnsRecordsPage },
  saas: { list: ZonesListPage, detail: SaasHostsPage },
  edgeone: { list: EdgeOneZonesPage, detail: EdgeOneDomainsPage },
  cloudflared: { list: TunnelsPage, detail: TunnelDetailPage },
}

const page = computed<Component | null>(() => {
  const entry = PAGE_REGISTRY[current.value?.type || '']
  if (!entry) return null
  return props.child ? entry.detail : entry.list
})

const pageProps = computed<ProviderPageProps>(() => ({
  providerId: providerId.value,
  providerName: current.value?.name ?? '',
  providerType: current.value?.type ?? '',
  zoneId: second.value,
}))

onMounted(async () => {
  try {
    if (!getCachedProviderAny(providerId.value)) await loadProviders({ force: true })
    if (!getCachedProviderAny(providerId.value)) {
      toast.warning('未找到该服务商')
      router.replace('/')
    }
  } catch (error) {
    toast.error(errorMessage(error))
  }
})
</script>

<template>
  <component :is="page" v-if="page" v-bind="pageProps" />
  <div v-else class="py-16 text-center">
    <div class="text-lg font-medium">{{ unconfigured?.name || providerId }}</div>
    <p class="text-muted-foreground mt-2 text-sm">
      {{ unconfigured ? '该服务商尚未配置完整，请先在服务商页补全关联与密钥。' : '当前服务商类型暂未接入。' }}
    </p>
    <Button v-if="unconfigured" variant="outline" size="sm" class="mt-4" @click="router.push('/providers')">
      前往服务商设置
    </Button>
  </div>
</template>
