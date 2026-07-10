import { defineAsyncComponent } from 'vue'
import hook from './hook'
import { providerBrand } from '@/providers/branding'

const ZonesView = defineAsyncComponent(() => import(/* webpackChunkName: "dns-zones" */ '@/modules/common/dns/views/ZonesView.vue'))
const SaasHostsView = defineAsyncComponent(() => import(/* webpackChunkName: "saas-hosts" */ './views/SaasHostsView.vue'))
import { providerPath } from '@/routes/paths'
import type { Provider, ProviderModule, RouteEntry } from '@/types'

const module: ProviderModule = {
  name: 'saas',
  providerType: 'saas',
  hook,
  resolveEntry(provider: Provider): RouteEntry {
    return { type: 'dns', id: provider.id, provider, component: ZonesView, props: { providerMeta: provider } }
  },
  resolveChild(provider: Provider, childId: string): RouteEntry {
    return {
      type: 'saas',
      id: provider.id,
      provider,
      childId,
      childType: 'saas-zone',
      component: SaasHostsView,
      props: { zoneName: childId },
    }
  },
  menuEntries(provider: Provider) {
    return [{ key: provider.id, label: provider.name, path: providerPath(provider.id) }]
  },
  cards(provider: Provider) {
    const brand = providerBrand('saas')
    return [{
      ...provider,
      path: providerPath(provider.id),
      description: '管理 Cloudflare SaaS 自定义主机名',
      tag: 'Cloudflare SaaS',
      color: brand.color,
      avatarColor: brand.avatarColor,
    }]
  },
}

export default module
