import { ApiError } from '../../../lib/http/api-error.js'
import { CloudflareZoneService, type ZoneListResult } from '../../cloudflare/services/zone-service.js'
import { CloudflareCustomHostnameGateway, type CloudflareCustomHostname } from '../gateways/custom-hostname-gateway.js'
import { PreferredDomainService } from './preferred-domain-service.js'
import { SaasPreferenceService, type HostnamePreference } from './preference-service.js'
import { SaasSyncConfigService } from './sync-config-service.js'
import { tryNormalizeFallbackOrigin } from '../utils/hostname-helpers.js'

interface HostnameListResult {
  items: CloudflareCustomHostname[]
  pagination: Record<string, unknown>
}

/**
 * Cloudflare for SaaS custom-hostname orchestration.
 * DNS sync preference resolution lives in SaasSyncConfigService.
 */
export class SaasHostnameService {
  constructor(
    private readonly cloudflareZones: CloudflareZoneService,
    private readonly cloudflareHostnames: CloudflareCustomHostnameGateway,
    private readonly preferredDomains: PreferredDomainService,
    private readonly preferences: SaasPreferenceService,
    private readonly syncConfigs: SaasSyncConfigService,
  ) {}

  async zones(providerId: string, page = 1, perPage = 100, name = '', refresh = false): Promise<ZoneListResult> {
    return this.cloudflareZones.list(await this.cloudflareProviderId(providerId), page, perPage, name, refresh)
  }

  cloudflareProviderIdFor(providerId: string): Promise<string> {
    return this.cloudflareProviderId(providerId)
  }

  /** Resolve CF provider + zone id for cache tags / events (zone name → id). */
  async resolveZoneRef(
    providerId: string,
    zoneName: string,
  ): Promise<{ cloudflareProviderId: string; zoneId: string }> {
    const [cloudflareProviderId, zoneId] = await this.resolveZone(providerId, zoneName)
    return { cloudflareProviderId, zoneId }
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
        return this.applyEffectiveSyncConfig(
          providerId,
          this.syncConfigs.mergePreference(enriched, preferenceMap[id] ?? null),
        )
      }),
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
    await this.cloudflareHostnames.invalidateCache(cfId, zoneId)
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
        hostnameName,
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

    const current = await this.cloudflareHostnames.show(cfId, zoneId, hostnameId)
    const cfPayload = this.syncConfigs.buildCloudflareUpdatePayload(current, data)

    let hostname = current
    if (Object.keys(cfPayload).length > 0) {
      hostname = await this.cloudflareHostnames.update(cfId, zoneId, hostnameId, cfPayload)
    }

    if (preferred !== null) {
      await this.preferences.setPreferredDomain(cfId, hostnameId, preferred)
    }

    if (
      'sync_target' in data ||
      'sync_zone' in data ||
      'sync_provider_id' in data ||
      'auto_preferred' in data ||
      preferred !== null
    ) {
      const normalized = await this.syncConfigs.normalizeSyncPreference(
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

    if (Object.keys(cfPayload).length > 0) {
      await this.preferences.markOwnershipTxtCleaned(
        cfId,
        hostnameId,
        false,
        String(hostname.hostname ?? hostnameFqdn),
      )
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
      await this.clearPreferencesForFqdn(providerId, hostnameFqdn)
      return { id: '' }
    }

    if (hostnameId !== '') {
      await this.cloudflareHostnames.delete(cfId, zoneId, hostnameId)
      await this.preferences.clear(cfId, hostnameId)
    }
    return { id: hostnameId }
  }

  async fallbackOriginInfo(
    providerId: string,
    zoneName: string,
    refresh = false,
  ): Promise<{ origin?: string | null; status?: string | null; [key: string]: unknown }> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    return this.cloudflareHostnames.fallbackOriginInfo(cfId, zoneId, refresh)
  }

  async setFallbackOrigin(
    providerId: string,
    zoneName: string,
    origin: string,
  ): Promise<{ origin?: string | null; status?: string | null }> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    const normalized = tryNormalizeFallbackOrigin(zoneName, origin)
    if (normalized == null) {
      throw new ApiError('fallback_origin_invalid', `Fallback origin must be a subdomain of ${zoneName}`, 422)
    }
    return this.cloudflareHostnames.setFallbackOrigin(cfId, zoneId, normalized)
  }

  async deleteFallbackOrigin(
    providerId: string,
    zoneName: string,
  ): Promise<{ origin?: string | null; status?: string | null }> {
    const [cfId, zoneId] = await this.resolveZone(providerId, zoneName)
    return this.cloudflareHostnames.deleteFallbackOrigin(cfId, zoneId)
  }

  async fallbackOrigin(providerId: string, zoneName: string): Promise<string | null> {
    const info = await this.fallbackOriginInfo(providerId, zoneName)
    return typeof info.origin === 'string' ? info.origin : null
  }

  async syncConfig(providerId: string, hostnameFqdn: string, zoneName = ''): Promise<Record<string, unknown>> {
    const byFqdn = await this.preferenceForFqdn(providerId, hostnameFqdn)
    if (byFqdn) return this.syncConfigs.presentExplicit(byFqdn)

    const [cfId, , hostnameId] =
      zoneName !== ''
        ? await this.resolveHostname(providerId, zoneName, hostnameFqdn)
        : await this.resolveHostnameByFqdn(providerId, hostnameFqdn)

    const preference = (await this.preferences.get(cfId, hostnameId)) ?? ({} as HostnamePreference)
    return this.syncConfigs.presentExplicit(preference)
  }

  async preferenceForFqdn(providerId: string, hostnameFqdn: string): Promise<HostnamePreference | null> {
    const cfId = await this.cloudflareProviderId(providerId)
    return this.syncConfigs.preferenceForFqdn(cfId, hostnameFqdn)
  }

  async clearPreferencesForFqdn(providerId: string, hostnameFqdn: string): Promise<number> {
    const cfId = await this.cloudflareProviderId(providerId)
    return this.syncConfigs.clearPreferencesForFqdn(cfId, hostnameFqdn)
  }

  async effectiveSyncConfig(providerId: string, hostnameFqdn: string, zoneName = ''): Promise<Record<string, unknown>> {
    const explicit = await this.syncConfig(providerId, hostnameFqdn, zoneName)
    return this.syncConfigs.effectiveSyncConfig(providerId, hostnameFqdn, {
      hostname: String(explicit.hostname ?? ''),
      sync_target: String(explicit.sync_target ?? ''),
      sync_provider_id: String(explicit.sync_provider_id ?? ''),
      sync_zone: String(explicit.sync_zone ?? ''),
      auto_preferred: Boolean(explicit.auto_preferred ?? false),
    })
  }

  async defaultSyncTarget(providerId: string): Promise<string> {
    return this.syncConfigs.defaultSyncTarget(providerId)
  }

  private async cloudflareProviderId(providerId: string): Promise<string> {
    return this.syncConfigs.cloudflareProviderId(providerId)
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

  private async withPreference(
    hostname: CloudflareCustomHostname,
    cfId: string,
    hostnameId: string,
  ): Promise<CloudflareCustomHostname> {
    return this.syncConfigs.mergePreference(
      hostname,
      hostnameId !== '' ? await this.preferences.get(cfId, hostnameId) : null,
    )
  }

  private async enrichDetailedHostname(
    providerId: string,
    hostname: CloudflareCustomHostname,
    cfId: string,
    zoneId: string,
    hostnameId: string,
    previousStatus = '',
  ): Promise<CloudflareCustomHostname> {
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

  private async applyEffectiveSyncConfig(
    providerId: string,
    hostname: CloudflareCustomHostname,
  ): Promise<CloudflareCustomHostname> {
    const effective = await this.effectiveSyncConfig(providerId, String(hostname.hostname ?? ''), '')
    return {
      ...hostname,
      effective_sync_target: effective.sync_target,
      effective_sync_provider_id: effective.sync_provider_id,
      effective_sync_zone: effective.sync_zone,
      sync_config_explicit: effective.explicit,
    }
  }
}
