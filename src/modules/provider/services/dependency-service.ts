import type { ProviderRepository } from '../repository.js'
import type { Provider, ProviderType } from '../types.js'
import type { SaasPreferenceService } from '../../saas/services/preference-service.js'

export interface ProviderDependency {
  kind: string
  type: string
  id: string
  name: string
  reason: string
}

const LINK_RULES: Array<{
  field: string
  label: string
  appliesTo: ProviderType[]
}> = [
  { field: 'dnspod_provider', label: 'EdgeOne 关联 DNSPod', appliesTo: ['edgeone'] },
  { field: 'cloudflare_provider', label: 'SaaS 关联 Cloudflare', appliesTo: ['saas'] },
  { field: 'cloudflare_dns_provider', label: 'SaaS Cloudflare DNS 同步', appliesTo: ['saas'] },
  { field: 'dnspod_provider', label: 'SaaS DNSPod 同步', appliesTo: ['saas'] },
  { field: 'cloudflare_provider', label: 'Cloudflare Tunnel 关联 Cloudflare', appliesTo: ['cloudflared'] },
]

/** Reverse provider references used by presentation and deletion protection. */
export class ProviderDependencyService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly hostnamePreferences: SaasPreferenceService,
  ) {}

  async map(providers?: Provider[]): Promise<Record<string, ProviderDependency[]>> {
    const source = providers ?? (await this.providers.all())
    const dependencies: Record<string, ProviderDependency[]> = {}

    for (const provider of source) {
      for (const rule of LINK_RULES) {
        if (!rule.appliesTo.includes(provider.type)) continue
        const targetId = String(provider[rule.field] ?? '').trim()
        if (!targetId) continue
        this.add(dependencies, targetId, {
          kind: 'provider',
          type: provider.type,
          id: provider.id,
          name: provider.name || provider.id,
          reason: rule.label,
        })
      }
    }

    const preferences = await this.hostnamePreferences.listAll()
    for (const [key, preference] of Object.entries(preferences)) {
      const targetId = preference.sync_provider_id.trim()
      if (!targetId) continue
      this.add(dependencies, targetId, {
        kind: 'hostname_sync',
        type: 'saas',
        id: key,
        name: preference.hostname || key,
        reason: 'SaaS 同步服务商',
      })
    }

    return dependencies
  }

  async forProvider(id: string, providers?: Provider[]): Promise<ProviderDependency[]> {
    return (await this.map(providers))[id] ?? []
  }

  private add(
    map: Record<string, ProviderDependency[]>,
    providerId: string,
    dependency: ProviderDependency,
  ): void {
    ;(map[providerId] ??= []).push(dependency)
  }
}
