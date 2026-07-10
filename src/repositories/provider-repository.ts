import { JsonStore } from '../support/json-store.js'
import { ApiError } from '../support/api-error.js'
import type {
  BaseProvider,
  PresentedProvider,
  Provider,
  ProviderInput,
  ProviderType,
} from '../types/provider.js'
import { getProviderDefinition, getProviderDefinitionsList } from '../config/providers.js'

interface ProvidersFile {
  items: Provider[]
}

const DEFAULT_PROVIDERS: ProvidersFile = { items: [] }

export class ProviderRepository {
  private readonly store = new JsonStore<ProvidersFile>('providers.json', DEFAULT_PROVIDERS)

  definitions() {
    return getProviderDefinitionsList()
  }

  async rawAll(): Promise<Provider[]> {
    const data = await this.store.read()
    return Array.isArray(data.items) ? data.items : []
  }

  async all(includeSecrets = false): Promise<PresentedProvider[]> {
    const providers = await this.rawAll()
    return Promise.all(providers.map((p) => this.present(p, includeSecrets, providers)))
  }

  async find(id: string, includeSecrets = false): Promise<PresentedProvider | null> {
    const providers = await this.rawAll()
    const provider = providers.find((p) => p.id === id)
    if (!provider) return null
    return this.present(provider, includeSecrets, providers)
  }

  async requireType(id: string, type: ProviderType, message?: string, code?: string): Promise<PresentedProvider> {
    const provider = await this.find(id, true)
    if (!provider || provider.type !== type) {
      throw new ApiError(code ?? 'provider_not_found', message ?? 'Provider not found', 404)
    }

    const definition = getProviderDefinition(type)
    const allProviders = await this.rawAll()
    if (!definition || !this.isConfigured(provider as unknown as Provider, definition, allProviders)) {
      throw new ApiError('provider_not_configured', 'Provider is not configured', 422)
    }

    return provider
  }

  async mutateAll(mutator: (current: Provider[]) => Provider[]): Promise<Provider[]> {
    const result = await this.store.transaction((current) => {
      const items = Array.isArray(current.items) ? current.items : []
      const next = mutator(items)
      const after = next.map((p) => this.normalizeForStorage(p))
      return { next: { items: after }, result: after }
    })
    return result ?? []
  }

  async present(provider: Provider, includeSecrets = false, allProviders?: Provider[]): Promise<PresentedProvider> {
    const definition = getProviderDefinition(provider.type)
    if (!definition || includeSecrets) {
      return { ...provider, configured: true, fields: {}, editable_fields: [] } as PresentedProvider
    }

    const providers = allProviders ?? (await this.rawAll())
    const name = this.displayName(provider, definition)
    const configured = this.isConfigured(provider, definition, providers)
    const hidden = this.hideSecretFields(provider, definition)

    return this.withPresentationFields({ ...hidden, name }, definition, configured)
  }

  private isConfigured(
    provider: Provider,
    definition: ReturnType<typeof getProviderDefinition>,
    allProviders: Provider[]
  ): boolean {
    if (!definition) return false
    for (const field of definition.required) {
      if ((provider as unknown as Record<string, unknown>)[field] === '') {
        return false
      }
    }
    return this.isLinkedProviderConfigured(provider, allProviders)
  }

  private isLinkedProviderConfigured(provider: Provider, allProviders: Provider[]): boolean {
    if (provider.type === 'edgeone') {
      return this.refConfigured(provider.dnspod_provider, 'dnspod', allProviders)
    }

    if (provider.type === 'saas') {
      if (!this.refConfigured(provider.cloudflare_provider, 'cloudflare', allProviders)) {
        return false
      }
      if (provider.dnspod_provider && !this.refConfigured(provider.dnspod_provider, 'dnspod', allProviders)) {
        return false
      }
      if (
        provider.cloudflare_dns_provider &&
        !this.refConfigured(provider.cloudflare_dns_provider, 'cloudflare', allProviders)
      ) {
        return false
      }
      return true
    }

    if (provider.type === 'cloudflared') {
      return this.refConfigured(provider.cloudflare_provider, 'cloudflare', allProviders)
    }

    return true
  }

  private refConfigured(
    refId: string | undefined,
    expectedType: ProviderType,
    allProviders: Provider[]
  ): boolean {
    if (!refId) return false
    const definition = getProviderDefinition(expectedType)
    if (!definition) return false

    const candidate = allProviders.find((p) => p.id === refId && p.type === expectedType)
    if (!candidate) return false

    for (const field of definition.required) {
      if ((candidate as unknown as Record<string, unknown>)[field] === '') {
        return false
      }
    }
    return true
  }

  private hideSecretFields(provider: Provider, definition: ReturnType<typeof getProviderDefinition>): Provider {
    if (!definition) return provider
    const copy = { ...provider } as unknown as Record<string, unknown>
    for (const field of definition.secret_fields) {
      const hasValue = (copy[field] ?? '') !== ''
      copy[field] = null
      copy[`${field}_configured`] = hasValue
    }
    return copy as unknown as Provider
  }

  private withPresentationFields(
    provider: Provider,
    definition: ReturnType<typeof getProviderDefinition>,
    configured: boolean
  ): PresentedProvider {
    if (!definition) {
      return { ...provider, configured, fields: {}, editable_fields: [] } as PresentedProvider
    }

    const presented = { ...provider } as unknown as Record<string, unknown>
    presented.editable_fields = definition.fields
    presented.fields = {}
    presented.configured = configured

    for (const field of definition.fields) {
      const hasValue =
        (presented[field] ?? '') !== '' || (presented[`${field}_configured`] as boolean | undefined) === true
      ;(presented.fields as Record<string, string>)[field] = hasValue ? ((presented[field] as string) || '已配置') : ''
    }

    return presented as PresentedProvider
  }

  private displayName(provider: Provider, definition: ReturnType<typeof getProviderDefinition>): string {
    const name = (provider.name ?? '').trim()
    return name !== '' ? name : (definition?.name ?? '')
  }

  private normalizeForStorage(provider: ProviderInput): Provider {
    const type = provider.type
    const definition = getProviderDefinition(type)

    const head: BaseProvider = {
      type: type as ProviderType,
      id: provider.id ?? '',
      name: provider.name ?? '',
    }

    const body: Record<string, string> = {}
    if (definition) {
      for (const field of definition.fields) {
        body[field] = ((provider as unknown as Record<string, unknown>)[field] as string) ?? ''
      }
    }

    return { ...head, ...body } as Provider
  }
}
