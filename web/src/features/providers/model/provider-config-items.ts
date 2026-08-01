import { providerTypeLabel } from './paths'
import type { Provider } from './types'

export type ProviderConfigItem = { key: string; value: string; ok?: boolean }

function linkedProviderName(providers: Provider[], providerId: string) {
  const linked = providers.find((item) => item.id === providerId)
  if (!linked) return '未配置'
  return linked.name || providerTypeLabel(linked.type) || '已配置'
}

/** Present provider links without exposing credentials or account identifiers. */
export function providerConfigItems(provider: Provider, providers: Provider[]): ProviderConfigItem[] {
  if (provider.type === 'dnspod' || provider.type === 'cloudflare') {
    return [{ key: 'api', value: provider.configured ? '已配置' : '未配置', ok: !!provider.configured }]
  }

  const items: ProviderConfigItem[] = []
  const fields = (provider.fields || {}) as Record<string, string>
  const pick = (key: string) => String(provider[key] || fields[key] || '').trim()

  if (provider.type === 'edgeone') {
    const dnspod = pick('dnspod_provider')
    if (dnspod) items.push({ key: 'edgeone-dnspod', value: linkedProviderName(providers, dnspod), ok: true })
  }

  if (provider.type === 'saas') {
    const cloudflare = pick('cloudflare_provider')
    const dnspod = pick('dnspod_provider')
    const cloudflareDns = pick('cloudflare_dns_provider')
    if (cloudflare)
      items.push({ key: 'saas-cf', value: `SaaS：${linkedProviderName(providers, cloudflare)}`, ok: true })
    if (dnspod)
      items.push({ key: 'saas-dnspod', value: `DNSPod 同步：${linkedProviderName(providers, dnspod)}`, ok: true })
    if (cloudflareDns) {
      items.push({
        key: 'saas-cf-dns',
        value: `Cloudflare DNS 同步：${linkedProviderName(providers, cloudflareDns)}`,
        ok: true,
      })
    }
  }

  if (provider.type === 'cloudflared') {
    const cloudflare = pick('cloudflare_provider')
    if (cloudflare) items.push({ key: 'tunnel-cf', value: linkedProviderName(providers, cloudflare), ok: true })
  }

  return items.length
    ? items
    : [{ key: 'api', value: provider.configured ? '已配置' : '未配置', ok: !!provider.configured }]
}
