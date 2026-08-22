import { SaaSPreferenceRepository } from './saas-preference.repository.js'
import type { ProviderRepository } from '../providers/provider.repository.js'
import type { ProviderIntegrity } from '../providers/provider-integrity.js'
import { ApiError } from '../../shared/http/api-error.js'

export interface HostnamePreference {
  [key: string]: unknown
  hostname: string
  preferred_domain: string
  sync_target: string
  sync_provider_id: string
  sync_zone: string
  auto_preferred: boolean
  ownership_txt_cleaned: boolean
}

export type NormalizedSyncPreference = Pick<
  HostnamePreference,
  'sync_target' | 'sync_provider_id' | 'sync_zone' | 'auto_preferred'
>

export class SaaSPreferenceService {
  constructor(
    private readonly store: SaaSPreferenceRepository,
    private readonly providerIntegrity: ProviderIntegrity,
    private readonly providers: ProviderRepository
  ) {}

  async get(cloudflareProviderId: string, hostnameId: string): Promise<HostnamePreference | null> {
    const items = await this.readItems()
    const key = this.buildKey(cloudflareProviderId, hostnameId)
    const row = items[key]
    return row && typeof row === 'object' ? this.present(row as Record<string, unknown>) : null
  }

  async listByProvider(cloudflareProviderId: string): Promise<Record<string, HostnamePreference>> {
    const items = await this.readItems()
    const prefix = cloudflareProviderId + ':'
    const map: Record<string, HostnamePreference> = {}

    for (const [key, value] of Object.entries(items)) {
      if (!key.startsWith(prefix) || typeof value !== 'object' || value === null) continue
      const hostnameId = key.slice(prefix.length)
      if (hostnameId !== '') map[hostnameId] = this.present(value as Record<string, unknown>)
    }

    return map
  }

  async listAll(options: { fresh?: boolean } = {}): Promise<Record<string, HostnamePreference>> {
    const items = await this.readItems(options)
    const result: Record<string, HostnamePreference> = {}
    for (const [key, value] of Object.entries(items)) {
      if (typeof value === 'object' && value !== null) {
        result[key] = this.present(value as Record<string, unknown>)
      }
    }
    return result
  }

  async setPreferredDomain(
    cloudflareProviderId: string,
    hostnameId: string,
    preferredDomain: string
  ): Promise<HostnamePreference> {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, hostnameId, { preferred_domain: preferredDomain.trim() })
    )
  }

  async setSyncConfig(input: {
    cloudflareProviderId: string
    hostnameId: string
    syncTarget: string
    syncProviderId: string
    syncZone: string
    autoPreferred: boolean
    hostname?: string
  }): Promise<HostnamePreference> {
    const normalized = await this.normalizeSyncConfig(
      input.cloudflareProviderId,
      input.syncTarget,
      input.syncProviderId,
      input.syncZone,
      input.autoPreferred
    )
    return this.setNormalizedSyncConfig(input.cloudflareProviderId, input.hostnameId, normalized, input.hostname ?? '')
  }

  async normalizeSyncConfig(
    cloudflareProviderId: string,
    syncTarget: string,
    syncProviderId: string,
    syncZone: string,
    autoPreferred: boolean
  ): Promise<NormalizedSyncPreference> {
    return this.withOwner(cloudflareProviderId, async (providers) => {
      const sync_target = syncTarget.trim()
      const sync_provider_id = syncProviderId.trim()
      if (sync_target || sync_provider_id) {
        const requiredType = sync_target === 'dnspod' ? 'dnspod' : sync_target === 'cloudflare_dns' ? 'cloudflare' : ''
        if (!requiredType || !sync_provider_id) {
          throw new ApiError('validation_failed', 'Invalid SaaS sync provider configuration', 422)
        }
        const provider = providers.find((item) => item.id === sync_provider_id)
        if (!provider || provider.type !== requiredType) {
          throw new ApiError('provider_reference_not_found', 'SaaS sync provider not found or has invalid type', 422)
        }
      }
      return {
        sync_target,
        sync_provider_id,
        sync_zone: syncZone.trim().toLowerCase(),
        auto_preferred: Boolean(autoPreferred),
      }
    })
  }

  setNormalizedSyncConfig(
    cloudflareProviderId: string,
    hostnameId: string,
    normalized: NormalizedSyncPreference,
    hostname = ''
  ): Promise<HostnamePreference> {
    return this.save(cloudflareProviderId, hostnameId, {
      hostname: hostname.trim(),
      ...normalized,
    })
  }

  ownershipTxtCleaned(cloudflareProviderId: string, hostnameId: string): Promise<boolean> {
    return this.get(cloudflareProviderId, hostnameId).then((pref) => pref?.ownership_txt_cleaned ?? false)
  }

  async markOwnershipTxtCleaned(
    cloudflareProviderId: string,
    hostnameId: string,
    cleaned: boolean,
    hostname = ''
  ): Promise<HostnamePreference> {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, hostnameId, {
        hostname: hostname.trim(),
        ownership_txt_cleaned: cleaned,
      })
    )
  }

  async clear(cloudflareProviderId: string, hostnameId: string): Promise<void> {
    const key = this.buildKey(cloudflareProviderId, hostnameId)
    await this.providerIntegrity.run(() =>
      this.store.transaction((current) => {
        const items = { ...(current.items ?? {}) }
        delete items[key]
        return { next: { items } }
      })
    )
  }

  async pruneOrphans(
    validCloudflareProviderIds: Set<string>,
    validAllProviderIds: Set<string>
  ): Promise<{ removedCount: number; repairedCount: number }> {
    let removedCount = 0
    let repairedCount = 0

    await this.providerIntegrity.run(() =>
      this.store.transaction((current) => {
        const items = { ...(current.items ?? {}) }
        for (const [key, value] of Object.entries(items)) {
          const colonIdx = key.indexOf(':')
          if (colonIdx === -1) {
            delete items[key]
            removedCount++
            continue
          }
          const cfId = key.slice(0, colonIdx)
          if (!validCloudflareProviderIds.has(cfId)) {
            delete items[key]
            removedCount++
            continue
          }

          if (value && typeof value === 'object') {
            const row = value as Record<string, unknown>
            const syncProviderId = String(row.sync_provider_id ?? '').trim()
            if (syncProviderId !== '' && !validAllProviderIds.has(syncProviderId)) {
              row.sync_provider_id = ''
              row.sync_target = ''
              repairedCount++
            }
          }
        }
        return { next: { items } }
      })
    )

    return { removedCount, repairedCount }
  }

  private async withOwner<T>(
    cloudflareProviderId: string,
    task: (providers: Awaited<ReturnType<ProviderRepository['all']>>) => Promise<T>
  ): Promise<T> {
    return this.providerIntegrity.run(async () => {
      const providers = await this.providers.all({ fresh: true })
      const owner = providers.find((provider) => provider.id === cloudflareProviderId)
      if (!owner || owner.type !== 'cloudflare') {
        throw new ApiError('provider_reference_not_found', 'SaaS owner provider not found or has invalid type', 422)
      }
      return task(providers)
    })
  }

  private async readItems(options: { fresh?: boolean } = {}): Promise<Record<string, unknown>> {
    const file = await this.store.read(options)
    return (file.items ?? {}) as Record<string, unknown>
  }

  private buildKey(cloudflareProviderId: string, hostnameId: string): string {
    return `${cloudflareProviderId}:${hostnameId}`
  }

  private async save(
    cloudflareProviderId: string,
    hostnameId: string,
    changes: Partial<HostnamePreference>
  ): Promise<HostnamePreference> {
    const key = this.buildKey(cloudflareProviderId, hostnameId)
    let saved: HostnamePreference = this.present({})

    await this.store.transaction((current) => {
      const items = { ...(current.items ?? {}) }
      const row = (items[key] as Record<string, unknown> | undefined) ?? {}
      const normalized = this.present(row)

      for (const field of ['hostname', 'preferred_domain', 'sync_target', 'sync_provider_id', 'sync_zone'] as const) {
        if (field in changes) {
          normalized[field] = String(changes[field] ?? '')
        }
      }
      if ('auto_preferred' in changes) normalized.auto_preferred = Boolean(changes.auto_preferred)
      if ('ownership_txt_cleaned' in changes) normalized.ownership_txt_cleaned = Boolean(changes.ownership_txt_cleaned)

      saved = normalized

      const shouldDelete =
        normalized.preferred_domain === '' &&
        normalized.sync_target === '' &&
        normalized.sync_provider_id === '' &&
        normalized.sync_zone === '' &&
        normalized.auto_preferred === false &&
        normalized.ownership_txt_cleaned === false

      if (shouldDelete) {
        delete items[key]
      } else {
        items[key] = normalized
      }

      return { next: { items } }
    })

    return saved
  }

  private present(row: Record<string, unknown>): HostnamePreference {
    return {
      hostname: String(row.hostname ?? ''),
      preferred_domain: String(row.preferred_domain ?? ''),
      sync_target: String(row.sync_target ?? ''),
      sync_provider_id: String(row.sync_provider_id ?? ''),
      sync_zone: String(row.sync_zone ?? ''),
      auto_preferred: Boolean(row.auto_preferred ?? false),
      ownership_txt_cleaned: Boolean(row.ownership_txt_cleaned ?? false),
    }
  }
}
