import { providerModule, resolveProviderChild, resolveProviderEntry } from '@/providers/registry'
import { providerPath } from './paths'
import type { Provider, RouteEntry } from '@/types'

export function resolveEntryRoute(providers: Provider[], routeId: string): RouteEntry | null {
  const provider = providers.find((provider) => provider.id === routeId)
  if (provider) return resolveProviderEntry(provider)

  return null
}

export function resolveChildRoute(providers: Provider[], routeId: string, childId: string): RouteEntry | null {
  const entry = resolveEntryRoute(providers, routeId)
  if (!entry) return null

  return resolveProviderChild(entry.provider, childId)
}

export function selectedMenuKey(path: string) {
  const first = path.split('/').filter(Boolean)[0] || ''
  return first || 'home'
}

export function providerMenuEntries(provider: Provider) {
  return (
    providerModule(provider)?.menuEntries?.(provider) || [
      { key: provider.id, label: provider.name, path: providerPath(provider.id) },
    ]
  )
}

export function providerCards(provider: Provider) {
  return providerModule(provider)?.cards?.(provider) || [{ ...provider, path: providerPath(provider.id) }]
}

export { providerChildPath, providerPath } from './paths'
