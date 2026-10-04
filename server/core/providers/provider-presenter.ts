import type { Provider, PresentedProvider, ProviderType } from './provider.types.js'
import { getProviderDefinition } from './provider-definitions.js'
import { providerLinkRulesFor, requiredLinkRule } from './provider-reference.js'

export class ProviderPresenter {
  present(provider: Provider, allProviders?: Provider[]): PresentedProvider {
    const definition = getProviderDefinition(provider.type)
    if (!definition) {
      // 未知类型：只输出最小安全字段，绝不展开原始对象（可能含密钥）
      return {
        id: provider.id,
        type: provider.type,
        name: String(provider.name ?? '').trim() || String(provider.type),
        configured: false,
        fields: {},
        editable_fields: [],
      } as PresentedProvider
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

  private isConfigured(
    provider: Provider,
    definition = getProviderDefinition(provider.type),
    allProviders: Provider[] = [provider]
  ): boolean {
    if (!definition) return false
    for (const field of definition.required) {
      if (String((provider as Record<string, unknown>)[field] ?? '').trim() === '') {
        return false
      }
    }
    return this.isLinkedProviderConfigured(provider, allProviders)
  }

  private isLinkedProviderConfigured(provider: Provider, allProviders: Provider[]): boolean {
    const rules = providerLinkRulesFor(provider.type)
    if (!rules.length) return true
    const definition = getProviderDefinition(provider.type)
    if (!definition) return false

    for (const rule of rules) {
      const linked = String((provider as Record<string, unknown>)[rule.field] ?? '').trim()
      // 必填字段必须指向已配置的关联服务商；可选字段仅在填写时校验
      if (linked === '' && !definition.required.includes(rule.field)) continue
      if (!this.refConfigured(linked, rule.targetType, allProviders)) return false
    }

    // Tunnel 建隧道需要关联账号 ID：关联服务商配置完整还不够
    if (provider.type === 'cloudflared') {
      const rule = requiredLinkRule('cloudflared')
      const linkedId = rule ? String((provider as Record<string, unknown>)[rule.field] ?? '').trim() : ''
      const linked = allProviders.find((candidate) => candidate.id === linkedId && candidate.type === rule?.targetType)
      return Boolean(linked && String((linked as Record<string, unknown>).account_id ?? '').trim() !== '')
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
      if (String((candidate as Record<string, unknown>)[field] ?? '').trim() === '') {
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
      ;(presented.fields as Record<string, string>)[field] = hasValue ? (presented[field] as string) || '已配置' : ''
    }

    return presented as PresentedProvider
  }

  private displayName(provider: Provider, definition: ReturnType<typeof getProviderDefinition>): string {
    const name = (provider.name ?? '').trim()
    return name !== '' ? name : (definition?.name ?? '')
  }
}
