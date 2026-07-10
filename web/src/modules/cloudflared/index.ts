import { defineAsyncComponent } from 'vue'
import { providerBrand } from '@/providers/branding'

const CloudflaredView = defineAsyncComponent(() => import(/* webpackChunkName: "cloudflared-view" */ './views/CloudflaredView.vue'))
const CloudflaredDetailView = defineAsyncComponent(() => import(/* webpackChunkName: "cloudflared-detail" */ './views/CloudflaredDetailView.vue'))
import { providerPath } from '@/routes/paths'
import type { Provider, ProviderModule, RouteEntry } from '@/types'

const module: ProviderModule = {
  name: 'cloudflared',
  providerType: 'cloudflared',
  resolveEntry(provider: Provider): RouteEntry {
    return { type: 'cloudflared', id: provider.id, provider, component: CloudflaredView }
  },
  resolveChild(provider: Provider, childId: string): RouteEntry | null {
    if (!String(childId || '').trim()) return null

    return {
      type: 'cloudflared',
      id: provider.id,
      provider,
      childId,
      childType: 'cloudflared-tunnel',
      component: CloudflaredDetailView,
      props: { tunnelId: childId },
    }
  },
  menuEntries(provider: Provider) {
    return [{ key: provider.id, label: provider.name, path: providerPath(provider.id) }]
  },
  cards(provider: Provider) {
    const brand = providerBrand('cloudflared')
    return [{
      ...provider,
      path: providerPath(provider.id),
      description: '管理 Cloudflare Tunnel 隧道与路由',
      tag: 'Cloudflare Tunnel',
      color: brand.color,
      avatarColor: brand.avatarColor,
    }]
  },
}

export default module
