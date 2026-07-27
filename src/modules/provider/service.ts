import { ProviderRepository } from './repository.js'
import { ApiError } from '../../lib/http/api-error.js'
import type { PresentedProvider, Provider, ProviderInput, ProviderType } from './types.js'
import { getProviderDefinition, getProviderDefinitionsList } from './definitions.js'
import { ProviderNormalizer } from './normalizer.js'
import { ProviderPresenter } from './presenter.js'
import { SaasPreferenceService } from '../saas/services/preference-service.js'
import { emitProviderMutated } from './events.js'

interface DependencyInfo {
  kind: string
  type: string
  id: string
  name: string
  reason: string
}

export class ProviderService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly normalizer: ProviderNormalizer,
    private readonly presenter: ProviderPresenter,
    private readonly hostnamePreferences: SaasPreferenceService,
    private readonly probes: {
      dnspodZones: { list(providerId: string, opts: { offset: number; limit: number; refresh: boolean }): Promise<{ items: unknown[]; pagination?: { total?: number | null } }> }
      cloudflareZones: {
        list(
          providerId: string,
          page: number,
          perPage: number,
          name: string,
          refresh: boolean,
        ): Promise<{ items: unknown[]; pagination?: { total_count?: number | null } }>
      }
      edgeoneZones: { zones(providerId: string, refresh: boolean): Promise<{ items: unknown[] }> }
      cloudflaredTunnels: { list(providerId: string, refresh: boolean): Promise<{ items: unknown[] }> }
    },
  ) {}

  definitions() {
    return getProviderDefinitionsList()
  }

  async all(): Promise<PresentedProvider[]> {
    const providers = await this.providers.all()
    const dependencyMap = await this.dependencyMap(providers)

    return this.presenter.presentAll(providers).map((provider) => ({
      ...provider,
      dependencies: dependencyMap[provider.id] ?? [],
    }))
  }

  async find(id: string): Promise<PresentedProvider | null> {
    const providers = await this.all()
    return providers.find((provider) => provider.id === id) ?? null
  }

  async create(data: Record<string, unknown>): Promise<PresentedProvider> {
    const definition = this.definitionFor(String(data.type ?? ''))
    const normalized = this.normalizer.normalize(data, definition)

    await this.providers.mutateAll((providers) => {
      if (this.existsId(providers, normalized.id)) {
        throw new ApiError('provider_exists', 'Provider already exists', 409)
      }
      return [...providers, normalized as Provider]
    })

    const presented = this.presenter.present(normalized as Provider)
    await emitProviderMutated({
      providerId: presented.id,
      action: 'create',
      target: presented.type,
    })
    return presented
  }

  async update(id: string, data: Record<string, unknown>): Promise<PresentedProvider> {
    let updated: ProviderInput | null = null

    await this.providers.mutateAll((providers) => {
      const index = this.locate(providers, id)
      const current = providers[index]

      if (data.type && data.type !== '' && data.type !== current.type) {
        throw new ApiError('provider_type_immutable', 'Provider type cannot be changed', 422)
      }

      const definition = this.definitionFor(current.type)
      const merged = this.mergeUpdatePayload(current, data, definition)
      updated = this.normalizer.normalize(merged, definition)
      providers[index] = updated as Provider

      return providers
    })

    if (!updated) {
      throw new ApiError('server_error', 'Provider update failed', 500)
    }
    const presented = this.presenter.present(updated as Provider)
    await emitProviderMutated({
      providerId: presented.id,
      action: 'update',
      target: presented.type,
    })
    return presented
  }

  async delete(id: string): Promise<void> {
    const providers = await this.providers.all()
    const dependencies = await this.dependenciesFor(id, providers)
    if (dependencies.length > 0) {
      throw new ApiError('provider_in_use', 'Provider is still in use', 409, { dependencies })
    }

    await this.providers.mutateAll((current) => {
      const next = current.filter((p) => p.id !== id)
      if (next.length === current.length) {
        throw new ApiError('provider_not_found', 'Provider not found', 404)
      }
      return next
    })
    await emitProviderMutated({
      providerId: id,
      action: 'delete',
    })
  }

  async sort(ids: string[]): Promise<PresentedProvider[]> {
    const trimmedIds = ids.map((id) => id.trim())

    const ordered = await this.providers.mutateAll((providers) => {
      this.validateSortOrder(trimmedIds, providers)
      const byId = this.indexById(providers)
      return trimmedIds.map((id) => byId[id])
    })

    const presented = this.presenter.presentAll(ordered)
    const dependencyMap = await this.dependencyMap(ordered)

    return presented.map((provider) => ({
      ...provider,
      dependencies: dependencyMap[provider.id] ?? [],
    }))
  }

  /**
   * Lightweight connectivity check — list a small page from the vendor API.
   * Linked providers (edgeone/saas/cloudflared) resolve their linked CF/DNSPod first.
   */
  async testConnection(id: string): Promise<{ ok: true; type: string; message: string; details?: Record<string, unknown> }> {
    const providers = await this.providers.all()
    const provider = providers.find((item) => item.id === id)
    if (!provider) throw new ApiError('provider_not_found', 'Provider not found', 404)

    try {
      switch (provider.type) {
        case 'dnspod': {
          const zones = await this.probes.dnspodZones.list(provider.id, {
            offset: 0,
            limit: 1,
            refresh: true,
          })
          return {
            ok: true,
            type: provider.type,
            message: `DNSPod 连接正常（域名 ${zones.pagination?.total ?? zones.items.length} 个）`,
            details: { total: zones.pagination?.total ?? zones.items.length },
          }
        }
        case 'cloudflare': {
          const zones = await this.probes.cloudflareZones.list(provider.id, 1, 1, '', true)
          return {
            ok: true,
            type: provider.type,
            message: `Cloudflare 连接正常（站点 ${zones.pagination?.total_count ?? zones.items.length} 个）`,
            details: { total: zones.pagination?.total_count ?? zones.items.length },
          }
        }
        case 'edgeone': {
          const linked = String((provider as Record<string, unknown>).dnspod_provider || '').trim()
          if (!linked) throw new ApiError('edgeone_dnspod_provider_not_found', 'EdgeOne 未关联 DNSPod', 422)
          await this.testConnection(linked)
          const zones = await this.probes.edgeoneZones.zones(provider.id, true)
          return {
            ok: true,
            type: provider.type,
            message: `EdgeOne 连接正常（站点 ${zones.items.length} 个）`,
            details: { total: zones.items.length, dnspod_provider: linked },
          }
        }
        case 'saas': {
          const cf = String((provider as Record<string, unknown>).cloudflare_provider || '').trim()
          if (!cf) throw new ApiError('saas_cloudflare_provider_missing', 'SaaS 未关联 Cloudflare', 422)
          await this.testConnection(cf)
          return {
            ok: true,
            type: provider.type,
            message: 'SaaS 关联的 Cloudflare 连接正常',
            details: { cloudflare_provider: cf },
          }
        }
        case 'cloudflared': {
          const cf = String((provider as Record<string, unknown>).cloudflare_provider || '').trim()
          if (!cf) throw new ApiError('cloudflared_cloudflare_provider_missing', 'Tunnel 未关联 Cloudflare', 422)
          await this.testConnection(cf)
          const tunnels = await this.probes.cloudflaredTunnels.list(provider.id, true)
          return {
            ok: true,
            type: provider.type,
            message: `Cloudflare Tunnel 连接正常（隧道 ${tunnels.items.length} 个）`,
            details: { total: tunnels.items.length, cloudflare_provider: cf },
          }
        }
        default: {
          const unknownType = String((provider as { type?: string }).type || 'unknown')
          throw new ApiError('provider_test_unsupported', `Unsupported provider type: ${unknownType}`, 422)
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      const msg = error instanceof Error ? error.message : String(error)
      throw new ApiError('provider_test_failed', msg || 'Provider test failed', 502, {
        provider_id: id,
        type: String((provider as { type?: string }).type || ''),
      })
    }
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

  private async dependencyMap(providers: Provider[]): Promise<Record<string, DependencyInfo[]>> {
    const map: Record<string, DependencyInfo[]> = {}

    for (const provider of providers) {
      const providerId = provider.id
      const type = provider.type

      const rules: Array<{ field: string; targetType: string; label: string; appliesTo: ProviderType[] }> = [
        { field: 'dnspod_provider', targetType: 'dnspod', label: 'EdgeOne 关联 DNSPod', appliesTo: ['edgeone'] },
        { field: 'cloudflare_provider', targetType: 'cloudflare', label: 'SaaS 关联 Cloudflare', appliesTo: ['saas'] },
        {
          field: 'cloudflare_dns_provider',
          targetType: 'cloudflare',
          label: 'SaaS Cloudflare DNS 同步',
          appliesTo: ['saas'],
        },
        { field: 'dnspod_provider', targetType: 'dnspod', label: 'SaaS DNSPod 同步', appliesTo: ['saas'] },
        {
          field: 'cloudflare_provider',
          targetType: 'cloudflare',
          label: 'Cloudflare Tunnel 关联 Cloudflare',
          appliesTo: ['cloudflared'],
        },
      ]

      for (const rule of rules) {
        if (!rule.appliesTo.includes(type)) continue
        const targetId = String((provider as Record<string, unknown>)[rule.field] ?? '').trim()
        if (targetId === '') continue

        if (!map[targetId]) map[targetId] = []
        map[targetId].push({
          kind: 'provider',
          type,
          id: providerId,
          name: provider.name || providerId,
          reason: rule.label,
        })
      }
    }

    const preferences = await this.hostnamePreferences.listAll()
    for (const [key, preference] of Object.entries(preferences)) {
      const syncProviderId = String(preference.sync_provider_id ?? '').trim()
      if (syncProviderId === '') continue

      const hostname = String(preference.hostname ?? '').trim()
      if (!map[syncProviderId]) map[syncProviderId] = []
      map[syncProviderId].push({
        kind: 'hostname_sync',
        type: 'saas',
        id: String(key),
        name: hostname || String(key),
        reason: 'SaaS 同步服务商',
      })
    }

    return map
  }

  private async dependenciesFor(id: string, providers: Provider[]): Promise<DependencyInfo[]> {
    const map = await this.dependencyMap(providers)
    return map[id] ?? []
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
