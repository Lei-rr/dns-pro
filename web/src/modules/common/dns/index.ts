import { defineAsyncComponent } from 'vue'
import { providerBrand } from '@/providers/branding'

const ZonesView = defineAsyncComponent(() => import(/* webpackChunkName: "dns-zones" */ './views/ZonesView.vue'))
const RecordsView = defineAsyncComponent(() => import(/* webpackChunkName: "dns-records" */ './views/RecordsView.vue'))
import { providerPath } from '@/routes/paths'
import type { Provider, ProviderModule, RouteEntry } from '@/types'

export function createDnsModule({
  name,
  providerType,
  hook,
  color,
  avatarColor,
  description,
}: {
  name: string
  providerType: string
  hook?: Record<string, unknown>
  color?: string
  avatarColor?: string
  description?: string | ((provider: Provider) => string)
}): ProviderModule {
  return {
    name,
    providerType,
    hook,
    resolveEntry(provider: Provider): RouteEntry {
      return { type: 'dns', id: provider.id, provider, component: ZonesView, props: { providerMeta: provider } }
    },
    resolveChild(provider: Provider, childId: string): RouteEntry {
      return {
        type: 'dns',
        id: provider.id,
        provider,
        childId,
        childType: 'dns-record',
        component: RecordsView,
        props: { domain: childId },
      }
    },
    menuEntries(provider: Provider) {
      return [{ key: provider.id, label: provider.name, path: providerPath(provider.id) }]
    },
    cards(provider: Provider) {
      const text = typeof description === 'function' ? description(provider) : description || `管理 ${provider.name}`
      const brand = providerBrand(providerType)
      return [
        {
          ...provider,
          path: providerPath(provider.id),
          description: text,
          tag: provider.name,
          color: color || brand.color,
          avatarColor: avatarColor || brand.avatarColor,
        },
      ]
    },
  }
}

export { ZonesView, RecordsView }
