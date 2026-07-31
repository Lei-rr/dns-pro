import { buildDnsSideEffects, type SideEffects } from '../../../lib/utils/side-effect-result.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { SyncOrchestrator } from '../../sync/services/sync-orchestrator.js'
import type { SyncRecord } from '../../sync/types.js'
import { isHostnameActive } from '../utils/host-status.js'
import type { CloudflareCustomHostname } from '../gateways/custom-hostname-gateway.js'
import { emitSaasHostnameMutated } from '../events.js'
import { SaasHostnameService } from './hostname-service.js'
import { SaasPreferenceService } from './preference-service.js'

/**
 * SaaS host lifecycle workflow.
 * DNS create/update/cleanup is delegated to the shared SyncOrchestrator.
 * Cache invalidation: emit saas.hostname.mutated with CF provider id + zone id tags.
 */
export class SaasWorkflowService {
  constructor(
    private readonly hostnames: SaasHostnameService,
    private readonly preferences: SaasPreferenceService,
    private readonly sync: SyncOrchestrator,
  ) {}

  async listHostnames(
    providerId: string,
    zoneName: string,
    refresh = false,
  ): Promise<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown>; side_effects?: SideEffects }> {
    const result = await this.hostnames.hostnames(providerId, zoneName, refresh)
    return result
  }

  async createHostname(
    providerId: string,
    zoneName: string,
    data: Record<string, unknown>,
    autoSync = false,
  ): Promise<Record<string, unknown>> {
    if (autoSync) {
      await this.sync.preflightSaas(providerId, String(data.hostname ?? ''), data)
    }

    const result = await this.hostnames.createHostname(providerId, zoneName, data)
    await this.emitMutated(providerId, zoneName, {
      hostname: String(result.hostname ?? data.hostname ?? ''),
      action: 'create',
    })

    if (autoSync && result.hostname) {
      const sync = await this.sync.syncSaasHostname(providerId, zoneName, String(result.hostname))
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
    autoSync = false,
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
      const collected = await this.sync.collectSaasRecords(providerId, zoneName, hostnameFqdn)
      beforeRecords = collected.records ?? []
    }

    const result = await this.hostnames.updateHostname(providerId, zoneName, hostnameFqdn, data)
    await this.emitMutated(providerId, zoneName, {
      hostname: hostnameFqdn,
      action: 'update',
      target: data.preferred_domain ? String(data.preferred_domain) : undefined,
    })

    if (shouldAutoSync) {
      const sync = await this.sync.resyncSaasHostname(providerId, zoneName, hostnameFqdn, beforeRecords)
      return {
        ...result,
        side_effects: buildDnsSideEffects({
          sync: this.sync.normalizeSyncSideEffect(sync, '已执行 DNS 重同步'),
        }),
      }
    }

    return result
  }

  async reconcileHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const result = await this.hostnames.reconcileHostname(providerId, zoneName, hostnameFqdn)
    const hostnameId = String(result.id ?? '').trim()

    if (await this.shouldCleanupOwnershipTxt(providerId, hostnameId, result)) {
      const cleanup = await this.sync.cleanupSaasStaleRecords(providerId, zoneName, hostnameFqdn)
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
  ): Promise<Record<string, unknown>> {
    // Order: collect DNS targets → delete CF custom hostname → clean DNS.
    // CF already gone must not block DNS cleanup.
    let collected: { hostname_fqdn: string; records: SyncRecord[] } | null = null
    if (autoCleanup) {
      collected = await this.sync.collectSaasRecords(providerId, zoneName, hostnameFqdn)
    }

    let result: Record<string, unknown> = { id: '', hostname: hostnameFqdn }
    try {
      result = await this.hostnames.deleteHostname(providerId, zoneName, hostnameFqdn)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : ''
      if (code !== 'saas_hostname_not_found') throw error
    }

    await this.emitMutated(providerId, zoneName, {
      hostname: hostnameFqdn,
      action: 'delete',
    })

    if (collected && collected.records.length > 0 && String(collected.hostname_fqdn ?? '') !== '') {
      const cleanup = await this.sync.cleanupSaasRecords(
        providerId,
        zoneName,
        String(collected.hostname_fqdn),
        collected.records,
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

  private async emitMutated(
    providerId: string,
    zoneName: string,
    fields: { hostname?: string; action: string; target?: string },
  ): Promise<void> {
    try {
      const zone = await this.hostnames.resolveZoneRef(providerId, zoneName)
      await emitSaasHostnameMutated({
        saasProviderId: providerId,
        cloudflareProviderId: zone.cloudflareProviderId,
        zoneName,
        zoneId: zone.zoneId,
        hostname: fields.hostname,
        action: fields.action,
        target: fields.target,
      })
    } catch {
      // Best-effort: mutation already applied; miss cache invalidate rather than fail the request.
    }
  }

  private async shouldCleanupOwnershipTxt(
    providerId: string,
    hostnameId: string,
    hostname: CloudflareCustomHostname,
  ): Promise<boolean> {
    if (!isHostnameActive(hostname) || hostnameId === '') return false
    return !(await this.preferences.ownershipTxtCleaned(await this.hostnames.cloudflareProviderIdFor(providerId), hostnameId))
  }

  private async rememberOwnershipCleanup(
    providerId: string,
    hostnameId: string,
    fqdn: string,
    result: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (hostnameId === '') return result
    const cleaned = String(result.status ?? '') !== 'failed'
    await this.preferences.markOwnershipTxtCleaned(
      await this.hostnames.cloudflareProviderIdFor(providerId),
      hostnameId,
      cleaned,
      fqdn,
    )
    return result
  }

}
