import { SaasPreferenceRepository } from '../../repositories/saas-preference-repository.js'

export interface HostnamePreference {
  hostname: string
  preferred_domain: string
  sync_target: string
  sync_provider_id: string
  sync_zone: string
  auto_preferred: boolean
  ownership_txt_cleaned: boolean
}

export class SaasPreferenceService {
  constructor(private readonly store: SaasPreferenceRepository = new SaasPreferenceRepository()) {}

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

  async listAll(): Promise<Record<string, HostnamePreference>> {
    const items = await this.readItems()
    const result: Record<string, HostnamePreference> = {}
    for (const [key, value] of Object.entries(items)) {
      if (typeof value === 'object' && value !== null) {
        result[key] = this.present(value as Record<string, unknown>)
      }
    }
    return result
  }

  async setPreferredDomain(cloudflareProviderId: string, hostnameId: string, preferredDomain: string): Promise<HostnamePreference> {
    return this.save(cloudflareProviderId, hostnameId, { preferred_domain: preferredDomain.trim() })
  }

  async setSyncConfig(
    cloudflareProviderId: string,
    hostnameId: string,
    syncTarget: string,
    syncProviderId: string,
    syncZone: string,
    autoPreferred: boolean,
    hostname = ''
  ): Promise<HostnamePreference> {
    return this.save(cloudflareProviderId, hostnameId, {
      hostname: hostname.trim(),
      sync_target: syncTarget.trim(),
      sync_provider_id: syncProviderId.trim(),
      sync_zone: syncZone.trim().toLowerCase(),
      auto_preferred: autoPreferred,
    })
  }

  ownershipTxtCleaned(cloudflareProviderId: string, hostnameId: string): Promise<boolean> {
    return this.get(cloudflareProviderId, hostnameId).then((pref) => pref?.ownership_txt_cleaned ?? false)
  }

  async markOwnershipTxtCleaned(cloudflareProviderId: string, hostnameId: string, cleaned: boolean, hostname = ''): Promise<HostnamePreference> {
    return this.save(cloudflareProviderId, hostnameId, { hostname: hostname.trim(), ownership_txt_cleaned: cleaned })
  }

  async clear(cloudflareProviderId: string, hostnameId: string): Promise<void> {
    const key = this.buildKey(cloudflareProviderId, hostnameId)
    await this.store.transaction((current) => {
      const items = { ...(current.items ?? {}) }
      delete items[key]
      return { next: { items } }
    })
  }

  private async readItems(): Promise<Record<string, unknown>> {
    const file = await this.store.read()
    return (file.items ?? {}) as Record<string, unknown>
  }

  private buildKey(cloudflareProviderId: string, hostnameId: string): string {
    return `${cloudflareProviderId}:${hostnameId}`
  }

  private async save(cloudflareProviderId: string, hostnameId: string, changes: Partial<HostnamePreference>): Promise<HostnamePreference> {
    const key = this.buildKey(cloudflareProviderId, hostnameId)
    let saved: HostnamePreference = this.present({})

    await this.store.transaction((current) => {
      const items = { ...(current.items ?? {}) }
      const row = (items[key] as Record<string, unknown> | undefined) ?? {}
      const normalized = this.present(row)

      const mutable = normalized as unknown as Record<string, unknown>
      for (const field of ['hostname', 'preferred_domain', 'sync_target', 'sync_provider_id', 'sync_zone'] as const) {
        if (field in changes) {
          mutable[field] = String(changes[field] ?? '')
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
        items[key] = normalized as unknown as Record<string, unknown>
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
