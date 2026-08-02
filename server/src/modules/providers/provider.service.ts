import { ProviderRepository } from './provider.repository.js'
import { ApiError } from '../../shared/http/api-error.js'
import type { PresentedProvider, Provider, ProviderInput } from './provider.types.js'
import { getProviderDefinition, getProviderDefinitionsList } from './provider-definitions.js'
import { ProviderNormalizer } from './provider-normalizer.js'
import { ProviderPresenter } from './provider-presenter.js'
import { invalidateProviderConfigurationCache } from './provider.cache.js'
import { validateProviderReferences } from './provider-reference.js'

export class ProviderService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly normalizer: ProviderNormalizer,
    private readonly presenter: ProviderPresenter
  ) {}

  definitions() {
    return getProviderDefinitionsList()
  }

  async all(options: { fresh?: boolean } = {}): Promise<PresentedProvider[]> {
    const providers = await this.providers.all(options)
    return this.presenter.presentAll(providers)
  }

  async find(id: string): Promise<PresentedProvider | null> {
    const providers = await this.all()
    return providers.find((provider) => provider.id === id) ?? null
  }

  async create(data: Record<string, unknown>): Promise<PresentedProvider> {
    const definition = this.definitionFor(String(data.type ?? ''))
    const normalized = this.normalizer.normalize(data, definition)

    const savedProviders = await this.providers.mutateAll((providers) => {
      if (this.existsId(providers, normalized.id)) {
        throw new ApiError('provider_exists', 'Provider already exists', 409)
      }
      validateProviderReferences(normalized as Provider, providers)
      return [...providers, normalized as Provider]
    })

    const presented = this.presenter.present(normalized as Provider, savedProviders)
    await invalidateProviderConfigurationCache(presented.id)
    return presented
  }

  async update(id: string, data: Record<string, unknown>): Promise<PresentedProvider> {
    let updated: ProviderInput | null = null

    const savedProviders = await this.providers.mutateAll((providers) => {
      const index = this.locate(providers, id)
      const current = providers[index]
      if (data.type && data.type !== '' && data.type !== current.type) {
        throw new ApiError('provider_type_immutable', 'Provider type cannot be changed', 422)
      }
      const definition = this.definitionFor(current.type)
      updated = this.normalizer.normalize(this.mergeUpdatePayload(current, data, definition), definition)
      validateProviderReferences(updated as Provider, providers)
      providers[index] = updated as Provider
      return providers
    })

    if (!updated) throw new ApiError('server_error', 'Provider update failed', 500)
    const presented = this.presenter.present(updated as Provider, savedProviders)
    await invalidateProviderConfigurationCache(presented.id)
    return presented
  }

  async delete(id: string): Promise<void> {
    await this.providers.mutateAll((current) => {
      const next = current.filter((provider) => provider.id !== id)
      if (next.length === current.length) throw new ApiError('provider_not_found', 'Provider not found', 404)
      return next
    })
    await invalidateProviderConfigurationCache(id)
  }

  async sort(ids: string[]): Promise<PresentedProvider[]> {
    const trimmedIds = ids.map((id) => id.trim())

    const ordered = await this.providers.mutateAll((providers) => {
      this.validateSortOrder(trimmedIds, providers)
      const byId = this.indexById(providers)
      return trimmedIds.map((id) => byId[id])
    })

    return this.presenter.presentAll(ordered)
  }

  private definitionFor(type: string) {
    const definition = getProviderDefinition(type)
    if (!definition) {
      throw new ApiError('validation_failed', 'Invalid provider type', 422, {
        errors: { type: 'Invalid provider type' },
      })
    }
    return definition
  }

  private validateSortOrder(ids: string[], providers: Provider[]): void {
    if (new Set(ids).size !== ids.length) {
      throw new ApiError('provider_order_duplicated', 'Provider order contains duplicate ids', 422)
    }

    const existingIds = Object.keys(this.indexById(providers))
    const diff1 = existingIds.filter((id) => !ids.includes(id))
    const diff2 = ids.filter((id) => !existingIds.includes(id))
    if (diff1.length > 0 || diff2.length > 0) {
      throw new ApiError('provider_order_mismatch', 'Provider order does not match current providers', 422)
    }
  }

  private existsId(providers: Provider[], id: string): boolean {
    return providers.some((p) => p.id === id)
  }

  private locate(providers: Provider[], id: string): number {
    const index = providers.findIndex((p) => p.id === id)
    if (index === -1) {
      throw new ApiError('provider_not_found', 'Provider not found', 404)
    }
    return index
  }

  private indexById(providers: Provider[]): Record<string, Provider> {
    const map: Record<string, Provider> = {}
    for (const p of providers) {
      map[p.id] = p
    }
    return map
  }

  private mergeUpdatePayload(
    current: Provider,
    data: Record<string, unknown>,
    definition: ReturnType<typeof getProviderDefinition>
  ): Record<string, unknown> {
    if (!definition) return { ...current, ...data }

    const merged: Record<string, unknown> = { ...current }
    merged.id = current.id
    merged.type = current.type

    if ('name' in data) {
      merged.name = data.name
    }

    const secretFields = new Set(definition.secret_fields)
    for (const field of definition.fields) {
      if (!(field in data)) continue
      const value = data[field]
      if (value === null) continue
      if (secretFields.has(field) && value === '') continue
      merged[field] = value
    }

    return merged
  }
}
