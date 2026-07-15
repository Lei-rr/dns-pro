import { completed, type DnsSideEffect, type SideEffects } from '../../../lib/utils/side-effect-result.js'
import { SyncOrchestrator } from '../../sync/services/sync-orchestrator.js'
import type { SyncRecord } from '../../sync/types.js'
import { isHostnameActive } from '../utils/host-status.js'
import type { CloudflareCustomHostname } from '../gateways/custom-hostname-gateway.js'
import { SaasHostnameService } from './hostname-service.js'
import { SaasPreferenceService } from './preference-service.js'

/**
 * SaaS host lifecycle workflow.
 * DNS create/update/cleanup is delegated to the shared SyncOrchestrator.
 */
export class SaasWorkflowService {
  constructor(
    private readonly hostnames: SaasHostnameService = new SaasHostnameService(),
    private readonly preferences: SaasPreferenceService = new SaasPreferenceService(),
    private readonly sync: SyncOrchestrator = new SyncOrchestrator(),
  ) {}

  async listHostnames(
    providerId: string,
    zoneName: string,
    page: number,
    perPage: number,
    refresh = false,
  ): Promise<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown>; side_effects?: SideEffects }> {
    const result = await this.hostnames.hostnames(providerId, zoneName, page, perPage, refresh)

    if (!refresh) return result

    const cleanup: Record<string, unknown> = {}
    for (const item of result.items ?? []) {
      const fqdn = String(item.hostname ?? '').trim()
      const hostnameId = String(item.id ?? '').trim()
      delete item.previous_status

      if (await this.shouldCleanupOwnershipTxt(providerId, hostnameId, item)) {
        cleanup[fqdn] = await this.rememberOwnershipCleanup(
          providerId,
          hostnameId,
          fqdn,
          await this.sync.cleanupSaasStaleRecords(providerId, zoneName, fqdn),
        )
      }
    }

    if (Object.keys(cleanup).length > 0) {
      return {
        ...result,
        side_effects: this.dnsSideEffects({ cleanup: completed('列表刷新后已执行 DNS 清理检查', [cleanup]) }),
      }
    }

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

    if (autoSync && result.hostname) {
      const sync = await this.sync.syncSaasHostname(providerId, zoneName, String(result.hostname))
      return {
        ...result,
        side_effects: this.dnsSideEffects({
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

    if (shouldAutoSync) {
      const sync = await this.sync.resyncSaasHostname(providerId, zoneName, hostnameFqdn, beforeRecords)
      return {
        ...result,
        side_effects: this.dnsSideEffects({
          sync: this.sync.normalizeSyncSideEffect(sync, '已执行 DNS 重同步'),
        }),
      }
    }

    return result
  }

  async refreshHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const result = await this.hostnames.refreshHostname(providerId, zoneName, hostnameFqdn)
    const hostnameId = String(result.id ?? '').trim()

    if (await this.shouldCleanupOwnershipTxt(providerId, hostnameId, result)) {
      const cleanup = await this.sync.cleanupSaasStaleRecords(providerId, zoneName, hostnameFqdn)
      return {
        ...result,
        side_effects: this.dnsSideEffects({
          cleanup: this.sync.normalizeCleanupSideEffect(cleanup, '已执行 DNS 清理'),
        }),
      }
    }

    delete result.previous_status
    return result
  }

  async deleteHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    autoCleanup = true,
  ): Promise<Record<string, unknown>> {
    const collected = autoCleanup ? await this.sync.collectSaasRecords(providerId, zoneName, hostnameFqdn) : null
    const result = await this.hostnames.deleteHostname(providerId, zoneName, hostnameFqdn)

    if (collected && collected.records.length > 0 && String(collected.hostname_fqdn ?? '') !== '') {
      const cleanup = await this.sync.cleanupSaasRecords(
        providerId,
        zoneName,
        String(collected.hostname_fqdn),
        collected.records,
      )
      return {
        ...result,
        side_effects: this.dnsSideEffects({
          cleanup: this.sync.normalizeCleanupSideEffect(cleanup, '已执行 DNS 删除后清理'),
        }),
      }
    }

    return result
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

  private dnsSideEffects(effects: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }): SideEffects {
    const sideEffects: SideEffects = { dns: {} }
    if (effects.sync) sideEffects.dns!.sync = effects.sync
    if (effects.cleanup) sideEffects.dns!.cleanup = effects.cleanup
    return sideEffects
  }
}
