import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import type { Provider } from '../../core/providers/provider.types.js'
import { PROVIDER_LINK_RULES } from '../../core/providers/provider-reference.js'
import type { SaaSPreferencePort } from '../../core/contracts/saas-preference.port.js'

interface ProviderDependency {
  kind: string
  type: string
  id: string
  name: string
  reason: string
}

type ProviderReference = Pick<Provider, 'id' | 'name' | 'type'> & Record<string, unknown>

/** Reverse provider references used by presentation and deletion protection. */
export class ProviderDependencyWorkflow {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly hostnamePreferences: SaaSPreferencePort
  ) {}

  async map(
    providers?: ProviderReference[],
    options: { freshPreferences?: boolean } = {}
  ): Promise<Record<string, ProviderDependency[]>> {
    const source = providers ?? (await this.providers.all())
    const dependencies: Record<string, ProviderDependency[]> = {}

    for (const provider of source) {
      for (const rule of PROVIDER_LINK_RULES) {
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

    const preferences = await this.hostnamePreferences.listAll({ fresh: options.freshPreferences })
    for (const [key, preference] of Object.entries(preferences)) {
      const ownerId = key.split(':', 1)[0]?.trim() || ''
      if (ownerId) {
        this.add(dependencies, ownerId, {
          kind: 'hostname_owner',
          type: 'saas',
          id: key,
          name: preference.hostname || key,
          reason: 'SaaS 主服务商',
        })
      }
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

  async forProvider(
    id: string,
    providers?: ProviderReference[],
    options: { freshPreferences?: boolean } = {}
  ): Promise<ProviderDependency[]> {
    return (await this.map(providers, options))[id] ?? []
  }

  private add(map: Record<string, ProviderDependency[]>, providerId: string, dependency: ProviderDependency): void {
    ;(map[providerId] ??= []).push(dependency)
  }
}
