import type { Provider, PresentedProvider, ProviderType } from '../../types/provider.js'
import { getProviderDefinition } from '../../config/providers.js'

export class ProviderPresenter {
  present(provider: Provider, allProviders?: Provider[]): PresentedProvider {
    const definition = getProviderDefinition(provider.type)
    if (!definition) {
      return { ...provider, configured: true, fields: {}, editable_fields: [] } as PresentedProvider
    }

    const providers = allProviders ?? [provider]
    const name = this.displayName(provider, definition)
    const configured = this.isConfigured(provider, definition, providers)
    const hidden = this.hideSecretFields(provider, definition)

    return this.withPresentationFields({ ...hidden, name }, definition, configured)
  }

  presentAll(providers: Provider[]): PresentedProvider[] {
    return providers.map((provider) => this.present(provider, providers))
  }

  isConfigured(
    provider: Provider,
    definition = getProviderDefinition(provider.type),
    allProviders: Provider[] = [provider]
  ): boolean {
    if (!definition) return false
    for (const field of definition.required) {
      if ((provider as Record<string, unknown>)[field] === '') {
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

  private refConfigured(refId: string | undefined, expectedType: ProviderType, allProviders: Provider[]): boolean {
    if (!refId) return false
    const definition = getProviderDefinition(expectedType)
    if (!definition) return false

    const candidate = allProviders.find((p) => p.id === refId && p.type === expectedType)
    if (!candidate) return false

    for (const field of definition.required) {
      if ((candidate as Record<string, unknown>)[field] === '') {
        return false
      }
    }
    return true
  }

  private hideSecretFields(provider: Provider, definition: ReturnType<typeof getProviderDefinition>): Provider {
    if (!definition) return provider
    const copy = { ...provider } as Record<string, unknown>
    for (const field of definition.secret_fields) {
      const hasValue = (copy[field] ?? '') !== ''
      copy[field] = null
      copy[`${field}_configured`] = hasValue
    }
    return copy as Provider
  }

  private withPresentationFields(
    provider: Provider,
    definition: ReturnType<typeof getProviderDefinition>,
    configured: boolean
  ): PresentedProvider {
    if (!definition) {
      return { ...provider, configured, fields: {}, editable_fields: [] } as PresentedProvider
    }

    const presented = { ...provider } as Record<string, unknown>
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
}
