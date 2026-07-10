import { ProviderRepository } from '../../repositories/provider-repository.js'
import { ApiError } from '../../support/api-error.js'
import { completed, type DnsSideEffect, type SideEffects } from '../../support/side-effect-result.js'
import { DnsPodSyncSupport } from '../concerns/dns-pod-sync-support.js'
import { CloudflareDnsRecordService } from '../cloudflare/cloudflare-dns-record-service.js'
import { CloudflareZoneService } from '../cloudflare/cloudflare-zone-service.js'
import { SaasHostnameService } from './saas-hostname-service.js'
import { SaasPreferenceService } from './saas-preference-service.js'
import { DnspodSyncDriver } from './sync-drivers/dnspod-sync-driver.js'
import { CloudflareDnsSyncDriver } from './sync-drivers/cloudflare-dns-sync-driver.js'
import { isHostnameActive } from './utils/host-status.js'
import type { SyncDriver, SyncRecord } from './sync-drivers/sync-driver.js'
import type { CloudflareCustomHostname } from '../../gateways/cloudflare-custom-hostname-gateway.js'

export class SaasWorkflowService {
  constructor(
    private readonly providers: ProviderRepository = new ProviderRepository(),
    private readonly hostnames: SaasHostnameService = new SaasHostnameService(),
    private readonly preferences: SaasPreferenceService = new SaasPreferenceService(),
    private readonly support: DnsPodSyncSupport = new DnsPodSyncSupport(),
    private readonly cloudflareZones: CloudflareZoneService = new CloudflareZoneService(),
    private readonly cloudflareDns: CloudflareDnsRecordService = new CloudflareDnsRecordService()
  ) {}

  async listHostnames(
    providerId: string,
    zoneName: string,
    page: number,
    perPage: number,
    refresh = false
  ): Promise<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown>; side_effects?: SideEffects }> {
    const result = await this.hostnames.hostnames(providerId, zoneName, page, perPage, refresh)

    if (!refresh) return result

    const cleanup: Record<string, unknown> = {}
    for (const item of result.items ?? []) {
      const fqdn = String(item.hostname ?? '').trim()
      const hostnameId = String(item.id ?? '').trim()
      delete item.previous_status

      if (await this.shouldCleanupOwnershipTxt(providerId, hostnameId, item)) {
        const driver = await this.syncDriverForHostname(providerId, zoneName, fqdn)
        cleanup[fqdn] = await this.rememberOwnershipCleanup(
          providerId,
          hostnameId,
          fqdn,
          await this.safeSync(() => driver.cleanupStaleRecords(providerId, zoneName, fqdn))
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

  async createHostname(providerId: string, zoneName: string, data: Record<string, unknown>, autoSync = false): Promise<Record<string, unknown>> {
    if (autoSync) {
      await (await this.syncDriverForInput(providerId, data)).preflight(providerId, String(data.hostname ?? ''), data)
    }

    const result = await this.hostnames.createHostname(providerId, zoneName, data)

    if (autoSync && result.hostname) {
      const driver = await this.syncDriverForHostname(providerId, zoneName, String(result.hostname))
      const sync = await this.safeSync(() => driver.sync(providerId, zoneName, String(result.hostname)))
      return { ...result, side_effects: this.dnsSideEffects({ sync: this.normalizeSyncOperation(sync, '已执行 DNS 同步') }) }
    }

    return result
  }

  async updateHostname(providerId: string, zoneName: string, hostnameFqdn: string, data: Record<string, unknown>, autoSync = false): Promise<Record<string, unknown>> {
    let beforeRecords: SyncRecord[] = []
    if (autoSync) {
      const collected = await (await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)).collectRecordsFor(providerId, zoneName, hostnameFqdn)
      beforeRecords = collected.records ?? []
    }

    const result = await this.hostnames.updateHostname(providerId, zoneName, hostnameFqdn, data)

    if (autoSync) {
      const driver = await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)
      const sync = await this.safeSync(() => driver.resyncAfterUpdate(providerId, zoneName, hostnameFqdn, beforeRecords))
      return { ...result, side_effects: this.dnsSideEffects({ sync: this.normalizeSyncOperation(sync, '已执行 DNS 重同步') }) }
    }

    return result
  }

  async refreshHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const result = await this.hostnames.refreshHostname(providerId, zoneName, hostnameFqdn)
    const hostnameId = String(result.id ?? '').trim()

    if (await this.shouldCleanupOwnershipTxt(providerId, hostnameId, result)) {
      const driver = await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)
      const cleanup = await this.safeSync(() => driver.cleanupStaleRecords(providerId, zoneName, hostnameFqdn))
      return {
        ...result,
        side_effects: this.dnsSideEffects({ cleanup: this.normalizeCleanupOperation(cleanup, '已执行 DNS 清理') }),
      }
    }

    delete result.previous_status
    return result
  }

  async deleteHostname(providerId: string, zoneName: string, hostnameFqdn: string, autoCleanup = true): Promise<Record<string, unknown>> {
    const driver = await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)
    const collected = autoCleanup ? await driver.collectRecordsFor(providerId, zoneName, hostnameFqdn) : null
    const result = await this.hostnames.deleteHostname(providerId, zoneName, hostnameFqdn)

    if (collected && collected.records.length > 0 && String(collected.hostname_fqdn ?? '') !== '') {
      const cleanup = await this.safeSync(() => driver.cleanup(providerId, String(collected.hostname_fqdn), collected.records))
      return { ...result, side_effects: this.dnsSideEffects({ cleanup: this.normalizeCleanupOperation(cleanup, '已执行 DNS 删除后清理') }) }
    }

    return result
  }

  private async syncDriverForInput(providerId: string, data: Record<string, unknown>): Promise<SyncDriver> {
    let target = String(data.sync_target ?? '').trim()
    if (target === '') target = await this.hostnames.defaultSyncTarget(providerId)
    return target === 'cloudflare_dns' ? this.cloudflareDnsDriver() : this.dnspodDriver()
  }

  private async syncDriverForHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<SyncDriver> {
    const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName)
    const target = String(config.sync_target ?? '').trim()
    return target === 'cloudflare_dns' ? this.cloudflareDnsDriver() : this.dnspodDriver()
  }

  private dnspodDriver(): SyncDriver {
    return new DnspodSyncDriver(this.hostnames, this.support)
  }

  private cloudflareDnsDriver(): SyncDriver {
    return new CloudflareDnsSyncDriver(this.providers, this.hostnames, this.cloudflareZones, this.cloudflareDns)
  }

  private async shouldCleanupOwnershipTxt(providerId: string, hostnameId: string, hostname: CloudflareCustomHostname): Promise<boolean> {
    if (!isHostnameActive(hostname) || hostnameId === '') return false
    return !(await this.preferences.ownershipTxtCleaned(await this.hostnames.cloudflareProviderIdFor(providerId), hostnameId))
  }

  private async rememberOwnershipCleanup(providerId: string, hostnameId: string, fqdn: string, result: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (hostnameId === '') return result
    const cleaned = String(result.status ?? '') !== 'failed'
    await this.preferences.markOwnershipTxtCleaned(await this.hostnames.cloudflareProviderIdFor(providerId), hostnameId, cleaned, fqdn)
    return result
  }

  private async safeSync<T>(fn: () => Promise<T>): Promise<T | Record<string, unknown>> {
    try {
      return await fn()
    } catch (error) {
      return {
        status: 'skipped',
        code: error instanceof ApiError ? error.code : 'sync_skipped',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private normalizeSyncOperation(result: unknown, defaultMessage: string): DnsSideEffect {
    const r = result as Record<string, unknown>
    let status = String(r.status ?? '')
    if (status === '') status = this.deriveSyncStatus(r)
    return { status: status as DnsSideEffect['status'], message: String(r.message ?? defaultMessage), details: [r] }
  }

  private normalizeCleanupOperation(result: unknown, defaultMessage: string): DnsSideEffect {
    const r = result as Record<string, unknown>
    const cleaned = Number(r.cleaned ?? 0)
    const status = r.status === 'skipped' ? 'skipped' : cleaned > 0 ? 'completed' : 'skipped'
    let message = String(r.message ?? '')
    if (message === '') {
      message = status === 'completed' ? defaultMessage : String(r.reason ?? '') !== '' ? 'DNS 清理已跳过' : '未找到需要清理的 DNS 记录'
    }
    return { status: status as DnsSideEffect['status'], message, details: [r] }
  }

  private deriveSyncStatus(result: Record<string, unknown>): DnsSideEffect['status'] {
    const records = Array.isArray(result.records) ? result.records : []
    if (records.length === 0) {
      return String(result.reason ?? '') !== '' || String(result.code ?? '') !== '' ? 'skipped' : 'completed'
    }
    for (const record of records) {
      if (typeof record === 'object' && record !== null && (record as Record<string, unknown>).status === 'failed') {
        return 'failed'
      }
    }
    return 'completed'
  }

  private dnsSideEffects(effects: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }): SideEffects {
    const sideEffects: SideEffects = { dns: {} }
    if (effects.sync) sideEffects.dns!.sync = effects.sync
    if (effects.cleanup) sideEffects.dns!.cleanup = effects.cleanup
    return sideEffects
  }
}
