<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCachedProvider, loadProviders } from '@/features/providers/stores/providers'
import { toast } from '@/shared/lib/toast'
import { errorMessage } from '@/shared/lib/errors'

// 静态导入：切换服务商/子页不再动态 chunk +「加载中…」
import ZonesPage from '@/features/dns/pages/ZonesPage.vue'
import RecordsPage from '@/features/dns/pages/RecordsPage.vue'
import SaasHostsPage from '@/features/saas/pages/SaasHostsPage.vue'
import EdgeOneZonesPage from '@/features/edgeone/pages/EdgeOneZonesPage.vue'
import EdgeOneRecordsPage from '@/features/edgeone/pages/EdgeOneRecordsPage.vue'
import CloudflaredPage from '@/features/cloudflared/pages/CloudflaredPage.vue'
import CloudflaredDetailPage from '@/features/cloudflared/pages/CloudflaredDetailPage.vue'

const props = defineProps<{ child?: boolean }>()
const route = useRoute()
const router = useRouter()

const providerId = computed(() => String(route.params.provider || ''))
const second = computed(() => String(route.params.second || ''))
const provider = computed(() => getCachedProvider(providerId.value))
const providerType = computed(() => provider.value?.type || '')

const page = computed((): { component: Component | null; pageProps: Record<string, unknown> } => {
  const type = providerType.value
  const id = providerId.value
  if (!type || !id) return { component: null, pageProps: {} }

  if (props.child) {
    if (type === 'dnspod' || type === 'cloudflare') {
      return { component: RecordsPage, pageProps: { providerId: id, zoneId: second.value } }
    }
    if (type === 'saas') {
      return { component: SaasHostsPage, pageProps: { providerId: id, zoneName: second.value } }
    }
    if (type === 'edgeone') {
      return { component: EdgeOneRecordsPage, pageProps: { providerId: id, zoneId: second.value } }
    }
    if (type === 'cloudflared') {
      return { component: CloudflaredDetailPage, pageProps: { providerId: id, tunnelId: second.value } }
    }
    return { component: null, pageProps: {} }
  }

  if (type === 'dnspod' || type === 'cloudflare' || type === 'saas') {
    return { component: ZonesPage, pageProps: { providerId: id } }
  }
  if (type === 'edgeone') {
    return { component: EdgeOneZonesPage, pageProps: { providerId: id } }
  }
  if (type === 'cloudflared') {
    return { component: CloudflaredPage, pageProps: { providerId: id } }
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
