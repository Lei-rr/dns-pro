import dnspodModule from '@/modules/dnspod'
import cloudflareModule from '@/modules/cloudflare'
import saasModule from '@/modules/saas'
import edgeOneModule from '@/modules/edgeone'
import cloudflaredModule from '@/modules/cloudflared'
import { defaultProviderHook, mergeHook } from '@/modules/common/dns/hook'
import { providerAvatarColor } from './branding'
import type { Provider, ProviderModule, RouteEntry } from '@/types'

const providerFrontendModules = [dnspodModule, cloudflareModule, saasModule, edgeOneModule, cloudflaredModule]

const providerModules: Record<string, ProviderModule> = Object.fromEntries(
  providerFrontendModules.filter((module) => module.providerType).map((module) => [module.providerType, module])
)

export function providerModule(provider: Provider | null) {
  if (!provider?.type) return null
  return providerModules[provider.type] || null
}

export function resolveProviderEntry(provider: Provider): RouteEntry | null {
  return providerModule(provider)?.resolveEntry?.(provider) || null
}

export function resolveProviderChild(provider: Provider, childId: string): RouteEntry | null {
  return providerModule(provider)?.resolveChild?.(provider, childId) || null
}

export function resolveProviderHook(type: string) {
  return mergeHook(providerModules[type]?.hook)
}

export function resolveProviderAvatarColor(provider: Provider) {
  const mod = providerModule(provider)
  if (!mod?.cards) return providerAvatarColor(provider?.type)
  const cards = mod.cards(provider)
  return cards[0]?.avatarColor || providerAvatarColor(provider?.type)
}

export { defaultProviderHook }
