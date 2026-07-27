import { ApiError } from '../../../lib/http/api-error.js'
import { type DnsSideEffect, type SideEffects } from '../../../lib/utils/side-effect-result.js'
import { SyncOrchestrator } from '../../sync/services/sync-orchestrator.js'
import { EdgeOneDomainService } from './domain-service.js'

export class EdgeOneWorkflowService {
  constructor(
    private readonly edgeone: EdgeOneDomainService,
    private readonly sync: SyncOrchestrator,
  ) {}

  async createAccelerationDomain(
    providerId: string,
    zoneId: string,
    data: Record<string, unknown>,
    autoSync = false,
  ): Promise<Record<string, unknown>> {
    if (autoSync) {
      await this.sync.preflightEdgeOne(providerId, String(data.domain_name ?? ''))
    }

    const result = await this.edgeone.createAccelerationDomain(providerId, zoneId, data)

    if (autoSync && result.name) {
      const cname = await this.edgeone.assignedCname(providerId, zoneId, String(result.name)).catch(() => '')
      const sync = await this.sync.syncEdgeOneCname(providerId, String(result.name), cname)
      return {
        ...result,
        side_effects: this.dnsSideEffects({
          sync: this.sync.normalizeSyncSideEffect(sync, '已执行 DNSPod CNAME 同步'),
        }),
      }
    }

    return result
  }

  async deleteAccelerationDomain(
    providerId: string,
    zoneId: string,
    domainName: string,
    autoCleanup = false,
  ): Promise<Record<string, unknown>> {
    let cname = ''
    if (autoCleanup) {
      try {
        cname = await this.edgeone.assignedCname(providerId, zoneId, domainName)
      } catch {
        cname = ''
      }
    }

    const result = await this.edgeone.deleteAccelerationDomain(providerId, zoneId, domainName)

    if (autoCleanup) {
      const cleanup = await this.sync.cleanupEdgeOneCname(providerId, domainName, cname)
      return {
        ...result,
        side_effects: this.dnsSideEffects({
          cleanup: this.sync.normalizeCleanupSideEffect(cleanup, '已执行 DNS 清理'),
        }),
      }
    }

    return result
  }

  async syncCname(providerId: string, zoneId: string, domainName: string): Promise<Record<string, unknown>> {
    const cname = await this.edgeone.assignedCname(providerId, zoneId, domainName)
    if (cname === '') {
      throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME not available yet', 422)
    }

    const sync = await this.sync.syncEdgeOneCname(providerId, domainName, cname)
    const side = this.sync.normalizeSyncSideEffect(sync, '已执行 DNSPod CNAME 同步')
    return { ...((sync as Record<string, unknown>) ?? {}), side_effects: this.dnsSideEffects({ sync: side }) }
  }

  private dnsSideEffects(effects: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }): SideEffects {
    const sideEffects: SideEffects = { dns: {} }
    if (effects.sync) sideEffects.dns!.sync = effects.sync
    if (effects.cleanup) sideEffects.dns!.cleanup = effects.cleanup
    return sideEffects
  }
}
