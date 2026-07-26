import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { CloudflareZoneService, type ZoneListResult } from '../../cloudflare/services/zone-service.js'
import { CloudflareCustomHostnameGateway, type CloudflareCustomHostname } from '../gateways/custom-hostname-gateway.js'
import { PreferredDomainService } from './preferred-domain-service.js'
import { SaasPreferenceService, type HostnamePreference } from './preference-service.js'
import type { SaasProvider } from '../../provider/types.js'

interface HostnameListResult {
  items: CloudflareCustomHostname[]
  pagination: Record<string, unknown>
}

export class SaasHostnameService {
  constructor(
    private readonly providers: ProviderRepository = new ProviderRepository(),
    private readonly cloudflareZones: CloudflareZoneService = new CloudflareZoneService(),
    private readonly cloudflareHostnames: CloudflareCustomHostnameGateway = new CloudflareCustomHostnameGateway(),
    private readonly preferredDomains: PreferredDomainService = new PreferredDomainService(),
    private readonly preferences: SaasPreferenceService = new SaasPreferenceService()
  ) {}

  async zones(providerId: string, page = 1, perPage = 100, name = '', refresh = false): Promise<ZoneListResult> {
    return this.cloudflareZones.list(await this.cloudflareProviderId(providerId), page, perPage, name, refresh)
  }

  cloudflareProviderIdFor(providerId: string): Promise<string> {
    return this.cloudflareProviderId(providerId)
  }

  async hostnames(providerId: string, zoneName: string, page = 1, perPage = 20, refresh = false): Promise<HostnameListResult> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)

    const previousStatusMap = new Map<string, string>()
    if (refresh) {
      try {
        const cached = await this.cloudflareHostnames.list(cfId, zoneId, page, perPage, false)
        for (const item of cached.items) {
          const id = item.id
          if (id !== '') previousStatusMap.set(id, item.status ?? '')
        }
      } catch {
        // ignore
      }
    }

    const result = await this.cloudflareHostnames.list(cfId, zoneId, page, perPage, refresh)
    const preferenceMap = await this.preferences.listByProvider(cfId)

    const items = await Promise.all(
      result.items.map((hostname) => {
        const id = hostname.id
        const enriched: CloudflareCustomHostname = refresh
          ? { ...hostname, previous_status: previousStatusMap.get(id) ?? '' }
          : hostname
        return this.applyEffectiveSyncConfig(providerId, this.mergePreference(enriched, preferenceMap[id] ?? null))
      })
    )

    return { ...result, items }
  }

  async showHostname(providerId: string, zoneName: string, hostnameFqdn: string, refresh = false): Promise<CloudflareCustomHostname> {
    const [cfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    const hostname = await this.cloudflareHostnames.show(cfId, zoneId, hostnameId, refresh)
    return this.enrichDetailedHostname(providerId, hostname, cfId, zoneId, hostnameId)
  }

  async refreshHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<CloudflareCustomHostname> {
    const [cfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, hostnameFqdn)

    let previousStatus = ''
    try {
      const cached = await this.cloudflareHostnames.show(cfId, zoneId, hostnameId, false)
      previousStatus = String(cached.status ?? '')
    } catch {
      // ignore
    }

    const hostname = await this.cloudflareHostnames.show(cfId, zoneId, hostnameId, true)
    this.cloudflareHostnames.invalidate(cfId, zoneId)
    return this.enrichDetailedHostname(providerId, hostname, cfId, zoneId, hostnameId, previousStatus)
  }

  async createHostname(providerId: string, zoneName: string, data: Record<string, unknown>): Promise<CloudflareCustomHostname> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    const preferred = await this.extractPreferredDomain(data)

    const hostname = await this.cloudflareHostnames.create(cfId, zoneId, data)
    const hostnameId = String(hostname.id ?? '')
    const hostnameName = String(hostname.hostname ?? '')

    if (hostnameId !== '' && preferred !== null) {
      await this.preferences.setPreferredDomain(cfId, hostnameId, preferred)
    }

    if (hostnameId !== '' && ('sync_target' in data || 'sync_zone' in data)) {
      await this.preferences.setSyncConfig(
        cfId,
        hostnameId,
        String(data.sync_target ?? ''),
        String(data.sync_provider_id ?? ''),
        String(data.sync_zone ?? ''),
        Boolean(data.auto_preferred ?? false),
        hostnameName
      )
    }

    if (hostnameId !== '') {
      await this.preferences.markOwnershipTxtCleaned(cfId, hostnameId, false, hostnameName)
    }

    return this.withPreference(hostname, cfId, hostnameId)
  }

  async updateHostname(providerId: string, zoneName: string, hostnameFqdn: string, data: Record<string, unknown>): Promise<CloudflareCustomHostname> {
    const [cfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    const preferred = 'preferred_domain' in data ? await this.extractPreferredDomain(data) : null
    const existing = (await this.preferences.get(cfId, hostnameId)) ?? ({} as HostnamePreference)

    // Always load current CF hostname first so preference-only edits can skip PATCH.
    const current = await this.cloudflareHostnames.show(cfId, zoneId, hostnameId)
    const cfPayload = this.buildCloudflareUpdatePayload(current, data)

    let hostname = current
    if (Object.keys(cfPayload).length > 0) {
      hostname = await this.cloudflareHostnames.update(cfId, zoneId, hostnameId, cfPayload)
    }

    if (preferred !== null) {
      await this.preferences.setPreferredDomain(cfId, hostnameId, preferred)
    }

    // Preference/preferred-domain edits must not let a broken frontend rewrite DNS linkage.
    // Normalize requested sync config against existing config + hostname FQDN.
    if ('sync_target' in data || 'sync_zone' in data || 'sync_provider_id' in data || 'auto_preferred' in data || preferred !== null) {
      const normalized = await this.normalizeSyncPreference(
        providerId,
        String(hostname.hostname ?? hostnameFqdn),
        existing,
        data,
      )
      await this.preferences.setSyncConfig(
        cfId,
        hostnameId,
        normalized.sync_target,
        normalized.sync_provider_id,
        normalized.sync_zone,
        normalized.auto_preferred,
        String(hostname.hostname ?? hostnameFqdn),
      )
    }

    // Only reset ownership cleanup marker when CF-side hostname/ssl fields actually change.
    if (Object.keys(cfPayload).length > 0) {
      await this.preferences.markOwnershipTxtCleaned(cfId, hostnameId, false, String(hostname.hostname ?? hostnameFqdn))
    }
    return this.withPreference(hostname, cfId, hostnameId)
  }

  async deleteHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<{ id: string }> {
    let cfId = ''
    let zoneId = ''
    let hostnameId = ''
    try {
      ;[cfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    } catch {
      // Hostname already gone from CF; skip API delete and clear preferences by FQDN.
      await this.clearPreferencesForFqdn(providerId, hostnameFqdn)
      return { id: '' }
    }

    if (hostnameId !== '') {
      await this.cloudflareHostnames.delete(cfId, zoneId, hostnameId)
      await this.preferences.clear(cfId, hostnameId)
    }
    return { id: hostnameId }
  }

  async fallbackOriginInfo(providerId: string, zoneName: string, refresh = false): Promise<{ origin?: string | null; status?: string | null; [key: string]: unknown }> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    return this.cloudflareHostnames.fallbackOriginInfo(cfId, zoneId, refresh)
  }

  async setFallbackOrigin(providerId: string, zoneName: string, origin: string): Promise<{ origin?: string | null; status?: string | null }> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    const normalized = this.normalizeFallbackOrigin(zoneName, origin)
    return this.cloudflareHostnames.setFallbackOrigin(cfId, zoneId, normalized)
  }

  async deleteFallbackOrigin(providerId: string, zoneName: string): Promise<{ origin?: string | null; status?: string | null }> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    return this.cloudflareHostnames.deleteFallbackOrigin(cfId, zoneId)
  }

  async fallbackOrigin(providerId: string, zoneName: string): Promise<string | null> {
    const info = await this.fallbackOriginInfo(providerId, zoneName)
    return typeof info.origin === 'string' ? info.origin : null
  }

  async syncConfig(providerId: string, hostnameFqdn: string, zoneName = ''): Promise<Record<string, unknown>> {
    // Local preference by FQDN first — still works after CF custom hostname is already deleted.
    const byFqdn = await this.preferenceForFqdn(providerId, hostnameFqdn)
    if (byFqdn) {
      return {
        hostname: byFqdn.hostname ?? '',
        sync_target: byFqdn.sync_target ?? '',
        sync_provider_id: byFqdn.sync_provider_id ?? '',
        sync_zone: byFqdn.sync_zone ?? '',
        auto_preferred: byFqdn.auto_preferred ?? false,
      }
    }

    const [cfId, , hostnameId] =
      zoneName !== ''
        ? await this.resolveHostname(providerId, zoneName, hostnameFqdn)
        : await this.resolveHostnameByFqdn(providerId, hostnameFqdn)

    const preference = (await this.preferences.get(cfId, hostnameId)) ?? ({} as HostnamePreference)

    return {
      hostname: preference.hostname ?? '',
      sync_target: preference.sync_target ?? '',
      sync_provider_id: preference.sync_provider_id ?? '',
      sync_zone: preference.sync_zone ?? '',
      auto_preferred: preference.auto_preferred ?? false,
    }
  }

  /** Match local preference by FQDN without requiring CF hostname to still exist. */
  async preferenceForFqdn(providerId: string, hostnameFqdn: string): Promise<HostnamePreference | null> {
    const cfId = await this.cloudflareProviderId(providerId)
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    if (fqdn === '') return null
    const map = await this.preferences.listByProvider(cfId)
    for (const pref of Object.values(map)) {
      if (String(pref.hostname ?? '').toLowerCase().replace(/\.$/, '').trim() === fqdn) {
        return pref
      }
    }
    return null
  }

  async clearPreferencesForFqdn(providerId: string, hostnameFqdn: string): Promise<number> {
    const cfId = await this.cloudflareProviderId(providerId)
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    if (fqdn === '') return 0
    const map = await this.preferences.listByProvider(cfId)
    let cleared = 0
    for (const [hostnameId, pref] of Object.entries(map)) {
      if (String(pref.hostname ?? '').toLowerCase().replace(/\.$/, '').trim() !== fqdn) continue
      await this.preferences.clear(cfId, hostnameId)
      cleared++
    }
    return cleared
  }

  async effectiveSyncConfig(providerId: string, hostnameFqdn: string, zoneName = ''): Promise<Record<string, unknown>> {
    const explicit = await this.syncConfig(providerId, hostnameFqdn, zoneName)
    const fqdn = hostnameFqdn.toLowerCase().replace(/\.$/, '').trim()
    let target = String(explicit.sync_target ?? '').trim()
    let provider = String(explicit.sync_provider_id ?? '').trim()
    let syncZone = String(explicit.sync_zone ?? '').trim().toLowerCase()

    // Repair polluted configs: e.g. api.guolei.cc linked to cloudflare_dns + 100022.xyz.
    if (target === 'cloudflare_dns' && syncZone !== '' && fqdn !== syncZone && !fqdn.endsWith('.' + syncZone)) {
      const defaultTarget = await this.defaultSyncTarget(providerId)
      if (defaultTarget === 'dnspod') {
        target = 'dnspod'
        provider = await this.effectiveSyncProviderId(providerId, 'dnspod', '')
        syncZone = this.guessZoneFromFqdn(fqdn)
      } else {
        // Drop invalid zone so caller can fail clearly instead of writing to wrong zone.
        syncZone = ''
      }
    }

    if (target === '') {
      target = await this.defaultSyncTarget(providerId)
    }
    if (provider === '') {
      provider = await this.effectiveSyncProviderId(providerId, target, '')
    }
    if (syncZone === '' && target === 'dnspod') {
      syncZone = this.guessZoneFromFqdn(fqdn)
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

  async defaultSyncTarget(providerId: string): Promise<string> {
    const provider = await this.providers.requireType<SaasProvider>(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')

    if (provider.dnspod_provider !== '') return 'dnspod'
    if (provider.cloudflare_dns_provider !== '' || provider.cloudflare_provider !== '') return 'cloudflare_dns'
    return ''
  }

  /**
   * Normalize/repair sync preference for updates.
   * Preferred-domain only edits must keep valid linkage and never accept a CF zone that cannot host the FQDN.
   */
  private async normalizeSyncPreference(
    providerId: string,
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

    const zoneMatchesHost = (candidate: string) => candidate !== '' && (fqdn === candidate || fqdn.endsWith('.' + candidate))

    // If frontend sends CF zone that cannot host this hostname, ignore and fall back.
    if (target === 'cloudflare_dns' && zone !== '' && !zoneMatchesHost(zone)) {
      target = String(existing.sync_target ?? '').trim()
      provider = String(existing.sync_provider_id ?? '').trim()
      zone = String(existing.sync_zone ?? '').trim().toLowerCase()
    }

    // Existing polluted config also needs repair.
    if (target === 'cloudflare_dns' && zone !== '' && !zoneMatchesHost(zone)) {
      target = ''
      provider = ''
      zone = ''
    }

    if (target === '') {
      target = await this.defaultSyncTarget(providerId)
    }
    if (provider === '') {
      provider = await this.effectiveSyncProviderId(providerId, target, '')
    }
    if (zone === '') {
      zone = this.guessZoneFromFqdn(fqdn)
    }

    // Final safety: Cloudflare DNS only when zone can own the hostname.
    if (target === 'cloudflare_dns' && !zoneMatchesHost(zone)) {
      const fallback = await this.defaultSyncTarget(providerId)
      if (fallback === 'dnspod') {
        target = 'dnspod'
        provider = await this.effectiveSyncProviderId(providerId, 'dnspod', '')
        zone = this.guessZoneFromFqdn(fqdn)
      }
    }

    return {
      sync_target: target,
      sync_provider_id: provider,
      sync_zone: zone,
      auto_preferred: autoPreferred,
    }
  }

  private guessZoneFromFqdn(fqdn: string): string {
    const parts = fqdn.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
    if (parts.length < 2) return fqdn
    return parts.slice(-2).join('.')
  }

  private async cloudflareProviderId(providerId: string): Promise<string> {
    const provider = await this.providers.requireType<SaasProvider>(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')
    const cfId = provider.cloudflare_provider.trim()
    if (cfId === '') {
      throw new ApiError('saas_cloudflare_provider_missing', 'SaaS provider is not linked to a Cloudflare provider', 422)
    }
    return cfId
  }

  private async resolveZone(providerId: string, zoneName: string): Promise<[string, string]> {
    const cfId = await this.cloudflareProviderId(providerId)
    const zoneId = await this.cloudflareZones.idByName(cfId, decodeURIComponent(zoneName))
    return [cfId, zoneId]
  }

  private async resolveHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<[string, string, string]> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    const hostnameId = await this.cloudflareHostnames.idByHostname(cfId, zoneId, decodeURIComponent(hostnameFqdn))
    return [cfId, zoneId, hostnameId]
  }

  private async resolveHostnameByFqdn(providerId: string, hostnameFqdn: string): Promise<[string, string, string]> {
    const cfId = await this.cloudflareProviderId(providerId)
    const fqdn = hostnameFqdn.toLowerCase().trim()
    const zones = await this.zones(providerId, 1, 1000, '', false)

    for (const zone of zones.items ?? []) {
      const zoneName = String(zone.name ?? '')
      if (zoneName === '') continue
      try {
        const [resolvedCfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, fqdn)
        if (resolvedCfId === cfId) return [resolvedCfId, zoneId, hostnameId]
      } catch {
        continue
      }
    }

    throw new ApiError('saas_hostname_not_found', `SaaS hostname ${hostnameFqdn} not found`, 404)
  }

  private async extractPreferredDomain(data: Record<string, unknown>): Promise<string | null> {
    if (!('preferred_domain' in data)) return null
    const preferred = String(data.preferred_domain ?? '').trim()
    delete data.preferred_domain

    if (preferred !== '' && !(await this.preferredDomains.isAllowed(preferred))) {
      throw new ApiError('preferred_domain_not_allowed', `Preferred domain ${preferred} is not allowed`, 422)
    }

    return preferred
  }

  /**
   * Build Cloudflare PATCH payload only when CF-managed fields actually change.
   * Preferred domain / auto_preferred / sync_* are local preference fields and must not trigger CF updates.
   */
  private buildCloudflareUpdatePayload(current: CloudflareCustomHostname, data: Record<string, unknown>): Record<string, unknown> {
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
      const prev = String((current.ssl?.settings as Record<string, unknown> | undefined)?.min_tls_version ?? '').trim()
      if (next !== '' && next !== prev) {
        payload.min_tls_version = next
      }
    }

    return payload
  }

  private mergePreference(hostname: CloudflareCustomHostname, preference: HostnamePreference | null): CloudflareCustomHostname {
    const metadata: Record<string, unknown> = {
      ...((hostname.custom_metadata && typeof hostname.custom_metadata === 'object'
        ? hostname.custom_metadata
        : {}) as Record<string, unknown>),
    }

    // 优先本地 preference；否则保留 CF custom_metadata / 顶层已有值
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

  private async withPreference(hostname: CloudflareCustomHostname, cfId: string, hostnameId: string): Promise<CloudflareCustomHostname> {
    return this.mergePreference(hostname, hostnameId !== '' ? await this.preferences.get(cfId, hostnameId) : null)
  }

  private async enrichDetailedHostname(providerId: string, hostname: CloudflareCustomHostname, cfId: string, zoneId: string, hostnameId: string, previousStatus = ''): Promise<CloudflareCustomHostname> {
    const ssl = hostname.ssl ?? {}
    const dcvUuid = String(ssl.dcv_delegation_uuid ?? '')
    const effectiveUuid = dcvUuid !== '' ? dcvUuid : await this.cloudflareZones.dcvDelegationUuid(cfId, zoneId)

    const enriched: CloudflareCustomHostname = {
      ...hostname,
      ssl: { ...ssl, dcv_delegation_uuid: effectiveUuid },
    }

    if (previousStatus !== '') {
      enriched.previous_status = previousStatus
    }

    return this.applyEffectiveSyncConfig(providerId, await this.withPreference(enriched, cfId, hostnameId))
  }

  private async applyEffectiveSyncConfig(providerId: string, hostname: CloudflareCustomHostname): Promise<CloudflareCustomHostname> {
    const effective = await this.effectiveSyncConfig(providerId, String(hostname.hostname ?? ''), '')
    return {
      ...hostname,
      effective_sync_target: effective.sync_target,
      effective_sync_provider_id: effective.sync_provider_id,
      effective_sync_zone: effective.sync_zone,
      sync_config_explicit: effective.explicit,
    }
  }

  private async effectiveSyncProviderId(providerId: string, target: string, explicitProviderId: string): Promise<string> {
    const explicit = explicitProviderId.trim()
    if (explicit !== '') return explicit

    const provider = await this.providers.requireType<SaasProvider>(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')

    if (target === 'dnspod') return provider.dnspod_provider ?? ''
    if (target === 'cloudflare_dns') {
      const cloudflareDns = provider.cloudflare_dns_provider ?? ''
      return cloudflareDns !== '' ? cloudflareDns : provider.cloudflare_provider
    }
    return ''
  }

  private normalizeFallbackOrigin(zoneName: string, origin: string): string {
    const zone = zoneName.toLowerCase().replace(/\.$/, '').trim()
    const value = origin.toLowerCase().replace(/\.$/, '').trim()

    if (value === '' || value === zone || !value.endsWith('.' + zone)) {
      throw new ApiError('fallback_origin_zone_mismatch', `Fallback origin must be a subdomain of ${zone}`, 422)
    }

    return value
  }
}
