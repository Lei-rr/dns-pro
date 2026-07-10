import { ProviderRepository } from '../../repositories/provider-repository.js'
import { ApiError } from '../../support/api-error.js'
import { CloudflareZoneService, type ZoneListResult } from '../cloudflare/cloudflare-zone-service.js'
import { CloudflareCustomHostnameGateway } from '../../gateways/cloudflare-custom-hostname-gateway.js'
import { PreferredDomainService } from './preferred-domain-service.js'
import { SaasPreferenceService, type HostnamePreference } from './saas-preference-service.js'

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

  async hostnames(providerId: string, zoneName: string, page = 1, perPage = 20, refresh = false): Promise<Record<string, unknown>> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)

    const previousStatusMap = new Map<string, string>()
    if (refresh) {
      try {
        const cached = await this.cloudflareHostnames.list(cfId, zoneId, page, perPage, false)
        for (const item of (cached.items as Array<Record<string, unknown>>) ?? []) {
          const id = String(item.id ?? '')
          if (id !== '') previousStatusMap.set(id, String(item.status ?? ''))
        }
      } catch {
        // ignore
      }
    }

    const result = await this.cloudflareHostnames.list(cfId, zoneId, page, perPage, refresh)
    const preferenceMap = await this.preferences.listByProvider(cfId)

    const items = await Promise.all(
      (((result.items as Array<Record<string, unknown>>) ?? []).map((hostname) => {
        const id = String(hostname.id ?? '')
        const enriched = refresh
          ? { ...hostname, previous_status: previousStatusMap.get(id) ?? '' }
          : hostname
        return this.applyEffectiveSyncConfig(providerId, this.mergePreference(enriched, preferenceMap[id] ?? null))
      }))
    )

    return { ...result, items }
  }

  async showHostname(providerId: string, zoneName: string, hostnameFqdn: string, refresh = false): Promise<Record<string, unknown>> {
    const [cfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    const hostname = await this.cloudflareHostnames.show(cfId, zoneId, hostnameId, refresh)
    return this.enrichDetailedHostname(providerId, hostname, cfId, zoneId, hostnameId)
  }

  async refreshHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
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

  async createHostname(providerId: string, zoneName: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
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

  async updateHostname(providerId: string, zoneName: string, hostnameFqdn: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const [cfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    const preferred = 'preferred_domain' in data ? await this.extractPreferredDomain(data) : null

    const hostname = await this.cloudflareHostnames.update(cfId, zoneId, hostnameId, data)

    if (preferred !== null) {
      await this.preferences.setPreferredDomain(cfId, hostnameId, preferred)
    }

    if ('sync_target' in data || 'sync_zone' in data) {
      await this.preferences.setSyncConfig(
        cfId,
        hostnameId,
        String(data.sync_target ?? ''),
        String(data.sync_provider_id ?? ''),
        String(data.sync_zone ?? ''),
        Boolean(data.auto_preferred ?? false),
        String(hostname.hostname ?? hostnameFqdn)
      )
    }

    await this.preferences.markOwnershipTxtCleaned(cfId, hostnameId, false, String(hostname.hostname ?? hostnameFqdn))
    return this.withPreference(hostname, cfId, hostnameId)
  }

  async deleteHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const [cfId, zoneId, hostnameId] = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    const result = await this.cloudflareHostnames.delete(cfId, zoneId, hostnameId)
    await this.preferences.clear(cfId, hostnameId)
    return result
  }

  async fallbackOriginInfo(providerId: string, zoneName: string, refresh = false): Promise<Record<string, unknown>> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    return this.cloudflareHostnames.fallbackOriginInfo(cfId, zoneId, refresh)
  }

  async setFallbackOrigin(providerId: string, zoneName: string, origin: string): Promise<Record<string, unknown>> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    const normalized = this.normalizeFallbackOrigin(zoneName, origin)
    return this.cloudflareHostnames.setFallbackOrigin(cfId, zoneId, normalized)
  }

  async deleteFallbackOrigin(providerId: string, zoneName: string): Promise<Record<string, unknown>> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    return this.cloudflareHostnames.deleteFallbackOrigin(cfId, zoneId)
  }

  async fallbackOrigin(providerId: string, zoneName: string): Promise<string | null> {
    const info = await this.fallbackOriginInfo(providerId, zoneName)
    return (info.origin as string | null) ?? null
  }

  async syncConfig(providerId: string, hostnameFqdn: string, zoneName = ''): Promise<Record<string, unknown>> {
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

  async effectiveSyncConfig(providerId: string, hostnameFqdn: string, zoneName = ''): Promise<Record<string, unknown>> {
    const explicit = await this.syncConfig(providerId, hostnameFqdn, zoneName)
    let target = String(explicit.sync_target ?? '').trim()
    if (target === '') {
      target = await this.defaultSyncTarget(providerId)
    }

    return {
      hostname: explicit.hostname ?? '',
      sync_target: target,
      sync_provider_id: await this.effectiveSyncProviderId(providerId, target, String(explicit.sync_provider_id ?? '')),
      sync_zone: explicit.sync_zone ?? '',
      auto_preferred: explicit.auto_preferred ?? false,
      explicit: String(explicit.sync_target ?? '') !== '' || String(explicit.sync_provider_id ?? '') !== '' || String(explicit.sync_zone ?? '') !== '',
    }
  }

  async defaultSyncTarget(providerId: string): Promise<string> {
    const provider = await this.providers.requireType(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')
    const record = provider as unknown as Record<string, unknown>

    if (String(record.dnspod_provider ?? '') !== '') return 'dnspod'
    if (String(record.cloudflare_dns_provider ?? '') !== '' || String(record.cloudflare_provider ?? '') !== '') return 'cloudflare_dns'
    return ''
  }

  private async cloudflareProviderId(providerId: string): Promise<string> {
    const provider = await this.providers.requireType(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')
    const cfId = String((provider as unknown as Record<string, unknown>).cloudflare_provider ?? '').trim()
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

    for (const zone of (zones.items as unknown as Array<Record<string, unknown>>) ?? []) {
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

  private mergePreference(hostname: Record<string, unknown>, preference: HostnamePreference | null): Record<string, unknown> {
    const metadata = (hostname.custom_metadata as Record<string, unknown> | null) ?? {}
    const preferred = preference?.preferred_domain?.trim() ?? ''
    const syncTarget = preference?.sync_target?.trim() ?? ''
    const syncProviderId = preference?.sync_provider_id?.trim() ?? ''
    const syncZone = preference?.sync_zone?.trim() ?? ''
    const autoPreferred = preference?.auto_preferred ?? false

    if (preferred !== '') {
      metadata.preferred_domain = preferred
    } else {
      delete metadata.preferred_domain
    }

    return {
      ...hostname,
      custom_metadata: Object.keys(metadata).length > 0 ? metadata : null,
      sync_target: syncTarget,
      sync_provider_id: syncProviderId,
      sync_zone: syncZone,
      auto_preferred: autoPreferred,
    }
  }

  private async withPreference(hostname: Record<string, unknown>, cfId: string, hostnameId: string): Promise<Record<string, unknown>> {
    return this.mergePreference(hostname, hostnameId !== '' ? await this.preferences.get(cfId, hostnameId) : null)
  }

  private async enrichDetailedHostname(providerId: string, hostname: Record<string, unknown>, cfId: string, zoneId: string, hostnameId: string, previousStatus = ''): Promise<Record<string, unknown>> {
    const ssl = (hostname.ssl as Record<string, unknown>) ?? {}
    const dcvUuid = String(ssl.dcv_delegation_uuid ?? '')
    const effectiveUuid = dcvUuid !== '' ? dcvUuid : await this.cloudflareZones.dcvDelegationUuid(cfId, zoneId)

    const enriched: Record<string, unknown> = {
      ...hostname,
      ssl: { ...ssl, dcv_delegation_uuid: effectiveUuid },
    }

    if (previousStatus !== '') {
      enriched.previous_status = previousStatus
    }

    return this.applyEffectiveSyncConfig(providerId, await this.withPreference(enriched, cfId, hostnameId))
  }

  private async applyEffectiveSyncConfig(providerId: string, hostname: Record<string, unknown>): Promise<Record<string, unknown>> {
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

    const provider = await this.providers.requireType(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')
    const record = provider as unknown as Record<string, unknown>

    if (target === 'dnspod') return String(record.dnspod_provider ?? '')
    if (target === 'cloudflare_dns') {
      const cloudflareDns = String(record.cloudflare_dns_provider ?? '')
      return cloudflareDns !== '' ? cloudflareDns : String(record.cloudflare_provider ?? '')
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
