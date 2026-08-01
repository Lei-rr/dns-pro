import { buildDnsSideEffects } from '../../shared/providers/side-effect-result.js'
import { ApiError } from '../../shared/http/api-error.js'
import { SaaSDnsSyncCoordinator } from './saas-dns-sync.coordinator.js'
import type { SyncRecord } from './saas-dns-sync.types.js'
import { isHostnameActive } from '../../modules/saas/saas-host-status.js'
import type { CloudflareCustomHostname } from '../../modules/saas/saas-custom-hostname.client.js'
import { invalidateSaaSHostnameCache } from '../../modules/saas/saas.cache.js'
import { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'
import { SaaSPreferenceService } from '../../modules/saas/saas-preference.service.js'

export type SaaSDeleteCleanupRecipe = {
  hostname_fqdn: string
  records: SyncRecord[]
}

export type SaaSDeleteOptions = {
  primaryDeleted?: boolean
  cleanup?: SaaSDeleteCleanupRecipe
  onCleanupPrepared?: (cleanup: SaaSDeleteCleanupRecipe) => Promise<void>
  onPrimaryDeleted?: () => Promise<void>
}

/**
 * SaaS host lifecycle workflow.
 * DNS create/update/cleanup is delegated to the shared SaaSDnsSyncCoordinator.
 * Cache invalidation: emit saas.hostname.mutated with CF provider id + zone id tags.
 */
export class SaaSDnsSyncWorkflow {
  constructor(
    private readonly hostnames: SaaSHostnameService,
    private readonly preferences: SaaSPreferenceService,
    private readonly sync: SaaSDnsSyncCoordinator
  ) {}

  async createHostname(
    providerId: string,
    zoneName: string,
    data: Record<string, unknown>,
    autoSync = false
  ): Promise<Record<string, unknown>> {
    if (autoSync) {
      await this.sync.preflightSaaS(providerId, String(data.hostname ?? ''), data)
    }

    const result = await this.hostnames.createHostname(providerId, zoneName, data)
    await this.invalidateCache(providerId, zoneName, String(result.hostname ?? data.hostname ?? ''))

    if (autoSync && result.hostname) {
      const sync = await this.sync.syncSaaSHostname(providerId, zoneName, String(result.hostname))
      return {
        ...result,
        side_effects: buildDnsSideEffects({
          sync: this.sync.normalizeSyncSideEffect(sync, '已执行 DNS 同步'),
        }),
      }
    }

    return result
  }

  async updateHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    data: Record<string, unknown>,
    autoSync = false
  ): Promise<Record<string, unknown>> {
    let beforeRecords: SyncRecord[] = []
    // Preference/DNS-linked edits should resync even if frontend forgot auto_sync.
    const shouldAutoSync =
      autoSync ||
      'preferred_domain' in data ||
      'auto_preferred' in data ||
      'sync_target' in data ||
      'sync_zone' in data ||
      'sync_provider_id' in data

    if (shouldAutoSync) {
      const collected = await this.sync.collectSaaSRecords(providerId, zoneName, hostnameFqdn)
      beforeRecords = collected.records ?? []
    }

    const result = await this.hostnames.updateHostname(providerId, zoneName, hostnameFqdn, data)
    await this.invalidateCache(providerId, zoneName, hostnameFqdn)

    if (shouldAutoSync) {
      const sync = await this.sync.resyncSaaSHostname(providerId, zoneName, hostnameFqdn, beforeRecords)
      return {
        ...result,
        side_effects: buildDnsSideEffects({
          sync: this.sync.normalizeSyncSideEffect(sync, '已执行 DNS 重同步'),
        }),
      }
    }

    return result
  }

  async reconcileHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string
  ): Promise<Record<string, unknown>> {
    const result = await this.hostnames.reconcileHostname(providerId, zoneName, hostnameFqdn)
    const hostnameId = String(result.id ?? '').trim()

    if (await this.shouldCleanupOwnershipTxt(providerId, hostnameId, result)) {
      const cleanup = await this.sync.cleanupSaaSStaleRecords(providerId, zoneName, hostnameFqdn)
      await this.rememberOwnershipCleanup(providerId, hostnameId, hostnameFqdn, cleanup)
      return {
        ...result,
        side_effects: buildDnsSideEffects({
          cleanup: this.sync.normalizeCleanupSideEffect(cleanup, '已执行 DNS 清理'),
        }),
      }
    }

    return result
  }

  async deleteHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    autoCleanup = true,
    options: SaaSDeleteOptions = {}
  ): Promise<Record<string, unknown>> {
    // Order: persist cleanup recipe → delete CF custom hostname → clean DNS.
    // A durable batch retry can skip completed stages; direct callers keep the same behavior.
    let collected: SaaSDeleteCleanupRecipe | null = options.cleanup ?? null
    if (autoCleanup && !collected) {
      collected = await this.sync.collectSaaSRecords(providerId, zoneName, hostnameFqdn)
      await options.onCleanupPrepared?.(collected)
    }

    let result: Record<string, unknown> = { id: '', hostname: hostnameFqdn }
    if (!options.primaryDeleted) {
      try {
        result = await this.hostnames.deleteHostname(providerId, zoneName, hostnameFqdn)
      } catch (error) {
        const code = error instanceof ApiError ? error.code : ''
        if (code !== 'saas_hostname_not_found') throw error
      }
      await options.onPrimaryDeleted?.()
    }

    await this.invalidateCache(providerId, zoneName, hostnameFqdn)

    if (collected && collected.records.length > 0 && String(collected.hostname_fqdn ?? '') !== '') {
      const cleanup = await this.sync.cleanupSaaSRecords(
        providerId,
        zoneName,
        String(collected.hostname_fqdn),
        collected.records
      )
      return {
        ...result,
        side_effects: buildDnsSideEffects({
          cleanup: this.sync.normalizeCleanupSideEffect(cleanup, '已执行 DNS 删除后清理'),
        }),
      }
    }

    return result
  }

  private async invalidateCache(providerId: string, zoneName: string, hostname: string): Promise<void> {
    try {
      const zone = await this.hostnames.resolveZoneRef(providerId, zoneName)
      invalidateSaaSHostnameCache(zone.cloudflareProviderId, zone.zoneId, hostname !== '')
    } catch {
      // Best-effort: mutation already applied; miss cache invalidate rather than fail the request.
    }
  }

  private async shouldCleanupOwnershipTxt(
    providerId: string,
    hostnameId: string,
    hostname: CloudflareCustomHostname
  ): Promise<boolean> {
    if (!isHostnameActive(hostname) || hostnameId === '') return false
    return !(await this.preferences.ownershipTxtCleaned(
      await this.hostnames.cloudflareProviderIdFor(providerId),
      hostnameId
    ))
  }

  private async rememberOwnershipCleanup(
    providerId: string,
    hostnameId: string,
    fqdn: string,
    result: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (hostnameId === '') return result
    const cleaned = String(result.status ?? '') !== 'failed'
    await this.preferences.markOwnershipTxtCleaned(
      await this.hostnames.cloudflareProviderIdFor(providerId),
      hostnameId,
      cleaned,
      fqdn
    )
    return result
  }
}
