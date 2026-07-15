import { ApiError } from '../../../lib/http/api-error.js'
import { type DnsSideEffect, type SideEffects } from '../../../lib/utils/side-effect-result.js'
import { DnsPodRecordOps } from '../../sync/services/dnspod-record-ops.js'
import { EdgeOneDomainService } from './domain-service.js'

export class EdgeOneWorkflowService {
  constructor(
    private readonly edgeone: EdgeOneDomainService = new EdgeOneDomainService(),
    private readonly support: DnsPodRecordOps = new DnsPodRecordOps()
  ) {}

  async createAccelerationDomain(providerId: string, zoneId: string, data: Record<string, unknown>, autoSync = false): Promise<Record<string, unknown>> {
    if (autoSync) {
      await this.preflight(providerId, String(data.domain_name ?? ''))
    }

    const result = await this.edgeone.createAccelerationDomain(providerId, zoneId, data)

    if (autoSync && result.name) {
      const sync = await this.safeSync(() => this.syncCnameInternal(providerId, zoneId, String(result.name)))
      return { ...result, side_effects: this.dnsSideEffects({ sync: this.presentCnameSync(sync) }) }
    }

    return result
  }

  async deleteAccelerationDomain(providerId: string, zoneId: string, domainName: string, autoCleanup = false): Promise<Record<string, unknown>> {
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
      const cleanup = await this.safeCleanupCname(providerId, domainName, cname)
      return { ...result, side_effects: this.dnsSideEffects({ cleanup: this.presentCleanup(cleanup) }) }
    }

    return result
  }

  async syncCname(providerId: string, zoneId: string, domainName: string): Promise<Record<string, unknown>> {
    const cname = await this.edgeone.assignedCname(providerId, zoneId, domainName)
    if (cname === '') {
      throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME not available yet', 422)
    }

    const sync = this.presentCnameSync(await this.syncCnameInternal(providerId, domainName, cname))
    return { ...sync, side_effects: this.dnsSideEffects({ sync }) }
  }

  private async syncCnameInternal(providerId: string, domainName: string, cname: string): Promise<Record<string, unknown>> {
    const dnspodProviderId = await this.support.requireDnspodProviderId(providerId, 'edgeone', 'EdgeOne')
    const fqdn = domainName.toLowerCase().trim()
    const dnspodZone = await this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'edgeone')

    if (cname === '') throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME is empty', 422)

    const record = {
      type: 'CNAME',
      name: fqdn,
      value: cname,
      line: '默认',
      purpose: 'edgeone_cname',
      provider_id: dnspodProviderId,
      remark: `EdgeOne 加速丨${fqdn}`,
    }

    const precleaned = await this.support.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
    const result = await this.support.sync(dnspodProviderId, dnspodZone, record)

    return { domain_name: fqdn, dnspod_zone: dnspodZone, precleaned, record: result }
  }

  private async safeSync<T>(fn: () => Promise<T>): Promise<T | Record<string, unknown>> {
    try {
      return await fn()
    } catch (error) {
      return {
        synced: false,
        action: error instanceof ApiError ? 'skipped' : 'failed',
        message: error instanceof Error ? error.message : String(error),
        record_id: '',
      }
    }
  }

  private async safeCleanupCname(providerId: string, domainName: string, cname: string): Promise<Record<string, unknown>> {
    try {
      const dnspodProviderId = await this.support.lookupDnspodProviderId(providerId, 'edgeone', 'EdgeOne')
      if (dnspodProviderId === '') return { cleaned: 0, records: [] }

      const fqdn = domainName.toLowerCase().trim()
      let dnspodZone = ''
      try {
        dnspodZone = await this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'edgeone')
      } catch {
        return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
      }

      if (cname !== '') {
        const record = {
          type: 'CNAME',
          name: fqdn,
          value: cname,
          line: '默认',
          purpose: 'edgeone_cname',
          provider_id: dnspodProviderId,
          remark: `EdgeOne 加速丨${fqdn}`,
        }
        const result = await this.support.delete(dnspodProviderId, dnspodZone, record)
        return { cleaned: result.status === 'deleted' ? 1 : 0, dnspod_zone: dnspodZone, records: [result] }
      }

      const results = await this.support.deleteRecordsByNameType(dnspodProviderId, dnspodZone, fqdn, 'CNAME', '默认')
      return { cleaned: results.filter((r) => r.status === 'deleted').length, dnspod_zone: dnspodZone, records: results }
    } catch (error) {
      return { cleaned: 0, records: [], reason: 'cleanup_failed', message: error instanceof Error ? error.message : String(error) }
    }
  }

  private async preflight(providerId: string, domainName: string): Promise<Record<string, unknown>> {
    const dnspodProviderId = await this.support.requireDnspodProviderId(providerId, 'edgeone', 'EdgeOne')
    const fqdn = domainName.toLowerCase().trim()
    if (fqdn === '') throw new ApiError('validation_failed', 'Domain name is required', 422)
    const dnspodZone = await this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'edgeone')
    return { dnspod_provider_id: dnspodProviderId, dnspod_zone: dnspodZone, domain_name: fqdn }
  }

  private presentCnameSync(syncResult: unknown): DnsSideEffect {
    const result = syncResult as Record<string, unknown>
    const record = (result.record as Record<string, unknown>) ?? {}
    const action = String(record.status ?? '')
    const status = action === 'failed' ? 'failed' : action === '' ? 'skipped' : 'completed'
    return {
      status,
      synced: status !== 'failed',
      action: action || 'unknown',
      message: this.syncActionMessage(action),
      record_id: String(record.record_id ?? ''),
      details: [record],
    }
  }

  private presentCleanup(result: unknown): DnsSideEffect {
    const r = result as Record<string, unknown>
    const cleaned = Number(r.cleaned ?? 0)
    const status = r.reason ? 'skipped' : cleaned > 0 ? 'completed' : 'skipped'
    return {
      status: status as DnsSideEffect['status'],
      message: status === 'completed' ? '已执行 DNS 清理' : String(r.reason ?? '未找到需要清理的 DNS 记录'),
      details: [r],
    }
  }

  private syncActionMessage(status: string): string {
    switch (status) {
      case 'created':
        return 'DNSPod CNAME 已创建'
      case 'updated':
        return 'DNSPod CNAME 已更新'
      case 'unchanged':
        return 'DNSPod CNAME 已是最新'
      case 'failed':
        return 'DNSPod CNAME 同步失败'
      default:
        return 'DNSPod CNAME 同步完成'
    }
  }

  private dnsSideEffects(effects: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }): SideEffects {
    const sideEffects: SideEffects = { dns: {} }
    if (effects.sync) sideEffects.dns!.sync = effects.sync
    if (effects.cleanup) sideEffects.dns!.cleanup = effects.cleanup
    return sideEffects
  }
}
