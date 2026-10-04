import type { SecretBox } from '../crypto/secret-box.js'
import { JsonStore } from '../store/json-store.js'
import { ApiError } from '../http/api-error.js'
import { openProviderSecrets, sealProviderSecrets } from './provider-secrets.js'
import type { Provider, ProviderInput, ProviderType } from './provider.types.js'

export interface ProvidersFile {
  items: Provider[]
}

export class ProviderRepository {
  constructor(
    private readonly store: JsonStore<ProvidersFile>,
    private readonly secrets: SecretBox
  ) {}

  async all(options: { fresh?: boolean } = {}): Promise<Provider[]> {
    const data = options.fresh ? await this.store.readFresh() : await this.store.read()
    const items = Array.isArray(data.items) ? data.items : []
    return items.map((item) => openProviderSecrets(item, this.secrets))
  }

  async find(id: string): Promise<Provider | null> {
    const providers = await this.all()
    return providers.find((p) => p.id === id) ?? null
  }

  async requireType<T extends Provider>(id: string, type: ProviderType, message?: string, code?: string): Promise<T> {
    const provider = await this.find(id)
    if (!provider || provider.type !== type) {
      throw new ApiError(code ?? 'provider_not_found', message ?? 'Provider not found', 404)
    }
    return provider as T
  }

  async mutateAll(mutator: (current: Provider[]) => Provider[]): Promise<Provider[]> {
    const result = await this.store.transaction((current) => {
      const items = (Array.isArray(current.items) ? current.items : []).map((item) =>
        openProviderSecrets(item, this.secrets)
      )
      const next = mutator(items)
      const plaintext = next.map((provider) => this.normalizeForStorage(provider))
      const sealed = plaintext.map((provider) => sealProviderSecrets(provider, this.secrets))
      // 落盘密文，返回值保持明文：mutator 与调用方的语义不变
      return { next: { items: sealed }, result: plaintext }
    })
    return result ?? []
  }

  private normalizeForStorage(provider: ProviderInput): Provider {
    const type = provider.type
    const head = {
      type,
      id: provider.id ?? '',
      name: provider.name ?? '',
    }
    const body: Record<string, unknown> = {}
    for (const field of Object.keys(provider)) {
      if (field === 'type' || field === 'id' || field === 'name') continue
      const value = (provider as Record<string, unknown>)[field]
      body[field] = typeof value === 'string' ? value : String(value ?? '')
    }
    return { ...head, ...body } as Provider
  }
}
