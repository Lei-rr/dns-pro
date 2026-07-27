import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import type { SaasProvider } from '../../provider/types.js'
import type { CloudflareCustomHostname } from '../gateways/custom-hostname-gateway.js'
import { guessZoneFromFqdn, zoneOwnsHostname } from '../utils/hostname-helpers.js'
import { SaasPreferenceService, type HostnamePreference } from './preference-service.js'

export type ExplicitSyncConfig = {
  hostname: string
  sync_target: string
  sync_provider_id: string
  sync_zone: string
  auto_preferred: boolean
}

export type EffectiveSyncConfig = ExplicitSyncConfig & {
  explicit: boolean
}

/**
 * SaaS DNS sync preference resolution / repair.
 * Kept separate from CF custom-hostname CRUD orchestration.
 */
export class SaasSyncConfigService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly preferences: SaasPreferenceService,
  ) {}

  async preferenceForFqdn(cloudflareProviderId: string, hostnameFqdn: string): Promise<HostnamePreference | null> {
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    if (fqdn === '') return null
    const map = await this.preferences.listByProvider(cloudflareProviderId)
    for (const pref of Object.values(map)) {
      if (String(pref.hostname ?? '').toLowerCase().replace(/\.$/, '').trim() === fqdn) {
        return pref
      }
    }
    return null
  }

  async clearPreferencesForFqdn(cloudflareProviderId: string, hostnameFqdn: string): Promise<number> {
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    if (fqdn === '') return 0
    const map = await this.preferences.listByProvider(cloudflareProviderId)
    let cleared = 0
    for (const [hostnameId, pref] of Object.entries(map)) {
      if (String(pref.hostname ?? '').toLowerCase().replace(/\.$/, '').trim() !== fqdn) continue
      await this.preferences.clear(cloudflareProviderId, hostnameId)
      cleared++
    }
    return cleared
  }

  presentExplicit(preference: HostnamePreference | Record<string, unknown> | null | undefined): ExplicitSyncConfig {
    const pref = preference ?? {}
    return {
      hostname: String((pref as { hostname?: unknown }).hostname ?? ''),
      sync_target: String((pref as { sync_target?: unknown }).sync_target ?? ''),
      sync_provider_id: String((pref as { sync_provider_id?: unknown }).sync_provider_id ?? ''),
      sync_zone: String((pref as { sync_zone?: unknown }).sync_zone ?? ''),
      auto_preferred: Boolean((pref as { auto_preferred?: unknown }).auto_preferred ?? false),
    }
  }

  async defaultSyncTarget(saasProviderId: string): Promise<string> {
    const provider = await this.providers.requireType<SaasProvider>(
      saasProviderId,
      'saas',
      'SaaS provider not found',
      'saas_provider_not_found',
    )
    if (provider.dnspod_provider !== '') return 'dnspod'
    if (provider.cloudflare_dns_provider !== '' || provider.cloudflare_provider !== '') return 'cloudflare_dns'
    return ''
  }

  async effectiveSyncProviderId(saasProviderId: string, target: string, explicitProviderId: string): Promise<string> {
    const explicit = explicitProviderId.trim()
    if (explicit !== '') return explicit

    const provider = await this.providers.requireType<SaasProvider>(
      saasProviderId,
      'saas',
      'SaaS provider not found',
      'saas_provider_not_found',
    )

    if (target === 'dnspod') return provider.dnspod_provider ?? ''
    if (target === 'cloudflare_dns') {
      const cloudflareDns = provider.cloudflare_dns_provider ?? ''
      return cloudflareDns !== '' ? cloudflareDns : provider.cloudflare_provider
    }
    return ''
  }

  async effectiveSyncConfig(
    saasProviderId: string,
    hostnameFqdn: string,
    explicit: ExplicitSyncConfig,
  ): Promise<EffectiveSyncConfig> {
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    let target = String(explicit.sync_target ?? '').trim()
    let provider = String(explicit.sync_provider_id ?? '').trim()
    let syncZone = String(explicit.sync_zone ?? '').trim().toLowerCase()

    // Repair polluted configs: e.g. api.guolei.cc linked to cloudflare_dns + wrong zone.
    if (target === 'cloudflare_dns' && syncZone !== '' && !zoneOwnsHostname(syncZone, fqdn)) {
      const defaultTarget = await this.defaultSyncTarget(saasProviderId)
      if (defaultTarget === 'dnspod') {
        target = 'dnspod'
        provider = await this.effectiveSyncProviderId(saasProviderId, 'dnspod', '')
        syncZone = guessZoneFromFqdn(fqdn)
      } else {
        syncZone = ''
      }
    }

    if (target === '') {
      target = await this.defaultSyncTarget(saasProviderId)
    }
    if (provider === '') {
      provider = await this.effectiveSyncProviderId(saasProviderId, target, '')
    }
    if (syncZone === '' && target === 'dnspod') {
      syncZone = guessZoneFromFqdn(fqdn)
    }

    return {
      hostname: explicit.hostname ?? '',
      sync_target: target,
      sync_provider_id: provider,
      sync_zone: syncZone,
      auto_preferred: explicit.auto_preferred ?? false,
      explicit:
        String(explicit.sync_target ?? '') !== '' ||
        String(explicit.sync_provider_id ?? '') !== '' ||
        String(explicit.sync_zone ?? '') !== '',
    }
  }

  /**
   * Normalize/repair sync preference for updates.
   * Preferred-domain only edits must keep valid linkage and never accept a CF zone that cannot host the FQDN.
   */
  async normalizeSyncPreference(
    saasProviderId: string,
    hostnameFqdn: string,
    existing: HostnamePreference,
    data: Record<string, unknown>,
  ): Promise<{ sync_target: string; sync_provider_id: string; sync_zone: string; auto_preferred: boolean }> {
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    const requestedTarget = 'sync_target' in data ? String(data.sync_target ?? '').trim() : ''
    const requestedProvider = 'sync_provider_id' in data ? String(data.sync_provider_id ?? '').trim() : ''
    const requestedZone = 'sync_zone' in data ? String(data.sync_zone ?? '').trim().toLowerCase() : ''

    let target = requestedTarget || String(existing.sync_target ?? '').trim()
    let provider = requestedProvider || String(existing.sync_provider_id ?? '').trim()
    let zone = requestedZone || String(existing.sync_zone ?? '').trim().toLowerCase()
    const autoPreferred =
      'auto_preferred' in data ? Boolean(data.auto_preferred) : Boolean(existing.auto_preferred ?? false)

    // If frontend sends CF zone that cannot host this hostname, ignore and fall back.
    if (target === 'cloudflare_dns' && zone !== '' && !zoneOwnsHostname(zone, fqdn)) {
      target = String(existing.sync_target ?? '').trim()
      provider = String(existing.sync_provider_id ?? '').trim()
      zone = String(existing.sync_zone ?? '').trim().toLowerCase()
    }

    // Existing polluted config also needs repair.
    if (target === 'cloudflare_dns' && zone !== '' && !zoneOwnsHostname(zone, fqdn)) {
      target = ''
      provider = ''
      zone = ''
    }

    if (target === '') {
      target = await this.defaultSyncTarget(saasProviderId)
    }
    if (provider === '') {
      provider = await this.effectiveSyncProviderId(saasProviderId, target, '')
    }
    if (zone === '') {
      zone = guessZoneFromFqdn(fqdn)
    }

    // Final safety: Cloudflare DNS only when zone can own the hostname.
    if (target === 'cloudflare_dns' && !zoneOwnsHostname(zone, fqdn)) {
      const fallback = await this.defaultSyncTarget(saasProviderId)
      if (fallback === 'dnspod') {
        target = 'dnspod'
        provider = await this.effectiveSyncProviderId(saasProviderId, 'dnspod', '')
        zone = guessZoneFromFqdn(fqdn)
      }
    }

    return {
      sync_target: target,
      sync_provider_id: provider,
      sync_zone: zone,
      auto_preferred: autoPreferred,
    }
  }

  mergePreference(
    hostname: CloudflareCustomHostname,
    preference: HostnamePreference | null,
  ): CloudflareCustomHostname {
    const metadata: Record<string, unknown> = {
      ...((hostname.custom_metadata && typeof hostname.custom_metadata === 'object'
        ? hostname.custom_metadata
        : {}) as Record<string, unknown>),
    }

    const fromPreference = String(preference?.preferred_domain ?? '').trim()
    const fromMetadata = String(metadata.preferred_domain ?? '').trim()
    const fromTop = String(hostname.preferred_domain ?? '').trim()
    const preferred = fromPreference || fromMetadata || fromTop

    const syncTarget = String(preference?.sync_target ?? hostname.sync_target ?? '').trim()
    const syncProviderId = String(preference?.sync_provider_id ?? hostname.sync_provider_id ?? '').trim()
    const syncZone = String(preference?.sync_zone ?? hostname.sync_zone ?? '').trim()
    const autoPreferred =
      preference != null ? Boolean(preference.auto_preferred) : Boolean(hostname.auto_preferred)

    if (preferred !== '') {
      metadata.preferred_domain = preferred
    }

    return {
      ...hostname,
      custom_metadata: Object.keys(metadata).length > 0 ? metadata : null,
      preferred_domain: preferred,
      sync_target: syncTarget,
      sync_provider_id: syncProviderId,
      sync_zone: syncZone,
      auto_preferred: autoPreferred,
    }
  }

  /**
   * Build Cloudflare PATCH payload only when CF-managed fields actually change.
   * Preferred domain / auto_preferred / sync_* are local preference fields.
   */
  buildCloudflareUpdatePayload(
    current: CloudflareCustomHostname,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {}

    if (Object.prototype.hasOwnProperty.call(data, 'custom_origin_server')) {
      const next = String(data.custom_origin_server ?? '').trim()
      const prev = String(current.custom_origin_server ?? '').trim()
      if (next !== prev) {
        payload.custom_origin_server = next
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'method')) {
      const next = String(data.method ?? '').trim()
      const prev = String(current.ssl?.method ?? '').trim()
      if (next !== '' && next !== prev) {
        payload.method = next
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'min_tls_version')) {
      const next = String(data.min_tls_version ?? '').trim()
      const prev = String(
        (current.ssl?.settings as Record<string, unknown> | undefined)?.min_tls_version ?? '',
      ).trim()
      if (next !== '' && next !== prev) {
        payload.min_tls_version = next
      }
    }

    return payload
  }

  /** Resolve linked Cloudflare provider id for a SaaS provider. */
  async cloudflareProviderId(saasProviderId: string): Promise<string> {
    const provider = await this.providers.requireType<SaasProvider>(
      saasProviderId,
      'saas',
      'SaaS provider not found',
      'saas_provider_not_found',
    )
    const cfId = provider.cloudflare_provider.trim()
    if (cfId === '') {
      throw new ApiError(
        'saas_cloudflare_provider_missing',
        'SaaS provider is not linked to a Cloudflare provider',
        422,
      )
    }
    return cfId
  }
}
