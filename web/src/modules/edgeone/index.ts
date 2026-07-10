import { defineAsyncComponent } from 'vue'
import { providerBrand } from '@/providers/branding'

const EdgeOneView = defineAsyncComponent(() => import(/* webpackChunkName: "edgeone-view" */ './views/EdgeOneView.vue'))
const EdgeOneRecordsView = defineAsyncComponent(() => import(/* webpackChunkName: "edgeone-records" */ './views/EdgeOneRecordsView.vue'))
import { providerPath } from '@/routes/paths'
import type { Provider, ProviderModule, RouteEntry } from '@/types'

const module: ProviderModule = {
  name: 'edgeone',
  providerType: 'edgeone',
  resolveEntry(provider: Provider): RouteEntry {
    return { type: 'edgeone', id: provider.id, provider, component: EdgeOneView }
  },
  resolveChild(provider: Provider, childId: string): RouteEntry | null {
    if (!String(childId || '').trim()) return null

    return {
      type: 'edgeone',
      id: provider.id,
      provider,
      childId,
      childType: 'edgeone-zone',
      component: EdgeOneRecordsView,
      props: { zoneId: childId },
    }
  },
  menuEntries(provider: Provider) {
    return [{ key: provider.id, label: provider.name, path: providerPath(provider.id) }]
  },
  cards(provider: Provider) {
    const brand = providerBrand('edgeone')
    return [{
      ...provider,
      path: providerPath(provider.id),
      description: '管理 EdgeOne 站点和加速域名',
      tag: 'EdgeOne',
      color: brand.color,
      avatarColor: brand.avatarColor,
    }]
  },
}

export default module
