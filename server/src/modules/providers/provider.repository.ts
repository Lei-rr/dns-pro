import { JsonStore } from '../../platform/storage/json-store.js'
import { ApiError } from '../../shared/http/api-error.js'
import type { Provider, ProviderInput, ProviderType } from './provider.types.js'

interface ProvidersFile {
  items: Provider[]
}

export class ProviderRepository {
  constructor(private readonly store: JsonStore<ProvidersFile>) {}

  async all(options: { fresh?: boolean } = {}): Promise<Provider[]> {
    const data = options.fresh ? await this.store.readFresh() : await this.store.read()
    return Array.isArray(data.items) ? data.items : []
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
      const items = Array.isArray(current.items) ? current.items : []
      const next = mutator(items)
      const after = next.map((p) => this.normalizeForStorage(p))
      return { next: { items: after }, result: after }
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
