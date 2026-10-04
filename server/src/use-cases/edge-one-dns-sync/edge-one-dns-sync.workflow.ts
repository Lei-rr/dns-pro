import { ApiError } from '../../kernel/http/api-error.js'
import { normalizeFqdn } from '../../lib/values.js'
import { isExplicitNotFound } from '../../kernel/providers/provider-error.js'
import {
  buildDnsSideEffects,
  runDnsSideEffect,
  toCleanupSideEffect,
  toSyncSideEffect,
} from '../../kernel/providers/side-effect-result.js'
import { DNSPOD_DEFAULT_LINE } from '../../domains/dnspod/dns-pod-record.service.js'
import type { DnsPodRecordSyncService } from '../../domains/dnspod/dns-pod-record-sync.service.js'
import type { EdgeOneDomainService } from '../../domains/edgeone/edge-one-domain.service.js'
import { normalizeAccelerationDomainPayload } from '../../domains/edgeone/edge-one-domain-payload.js'
import { invalidateEdgeOneDomainCache } from '../../domains/edgeone/edge-one.cache.js'
import { dnsZoneKey, edgeOneZoneKey } from '../../kernel/jobs/job-types.js'

type DeleteOptions = {
  primaryDeleted?: boolean
  onPrimaryDeleted?: () => Promise<void>
  /** 任务级快照中的 CNAME；提供后不再逐条查询（批量场景避免重复全量拉取） */
  cname?: string
}

/**
 * EdgeOne 加速域名生命周期 + DNSPod CNAME 副作用。
 * 创建/删除/修复解析在此编排；纯 EdgeOne 调用留在模块内。
 */
export class EdgeOneDnsSyncWorkflow {
  constructor(
    private readonly domains: EdgeOneDomainService,
    private readonly dns: DnsPodRecordSyncService
  ) {}

  /**
   * 本工作流会写入的底层资源：EdgeOne 站点 + 各加速域名对应的 DNSPod 域名。
   * 用于与 DNS 批量等任务做跨工作流互斥。
   */
  async resourceKeys(providerId: string, zoneId: string, domains: string[]): Promise<string[]> {
    const keys = [edgeOneZoneKey(providerId, zoneId)]
    const dnspodProviderId = await this.dns.lookupDnsPodProviderId(providerId, 'edgeone', 'EdgeOne').catch(() => '')
    if (!dnspodProviderId) return keys
    for (const domain of new Set(domains.map((item) => normalizeFqdn(item)))) {
      if (domain === '') continue
      const zone = await this.dns.matchZone(dnspodProviderId, domain).catch(() => '')
      if (zone) keys.push(dnsZoneKey('dnspod', dnspodProviderId, zone))
    }
    return keys
  }

  async createAccelerationDomain(
    providerId: string,
    zoneId: string,
    data: Record<string, unknown>,
    autoSync = false
  ): Promise<Record<string, unknown>> {
    const { domain_name: domainName } = normalizeAccelerationDomainPayload(data)
    // 自动同步时先校验 DNSPod 关联与域名归属，避免创建后才发现无法写回
    if (autoSync) await this.resolveDnsTarget(providerId, domainName)

    const result = await this.domains.createAccelerationDomain(providerId, zoneId, data)
    if (!autoSync) return result

    const sync = await runDnsSideEffect(async () => {
      const cname = await this.domains.assignedCname(providerId, zoneId, result.name)
      return this.syncCname(providerId, result.name, cname)
    })
    return {
      ...result,
      side_effects: buildDnsSideEffects({ sync: toSyncSideEffect(sync, '已执行 DNSPod CNAME 同步') }),
    }
  }

  async deleteAccelerationDomain(
    providerId: string,
    zoneId: string,
    domainName: string,
    autoCleanup = false,
    options: DeleteOptions = {}
  ): Promise<Record<string, unknown>> {
    // 删除前记录 CNAME，清理时只删指向 EdgeOne 的记录
    let cname = options.cname ?? ''
    if (autoCleanup && !options.primaryDeleted && options.cname === undefined) {
      cname = await this.domains.assignedCname(providerId, zoneId, domainName).catch((error: unknown) => {
        if (!isEdgeOneNotFound(error)) throw error
        return ''
      })
    }

    let primary: Record<string, unknown> = { name: domainName }
    let primaryAlreadyMissing = false
    if (!options.primaryDeleted) {
      try {
        primary = await this.domains.deleteAccelerationDomain(providerId, zoneId, domainName)
      } catch (error) {
        if (!isEdgeOneNotFound(error)) throw error
        primaryAlreadyMissing = true
        invalidateEdgeOneDomainCache(providerId, zoneId)
      }
    }
    await options.onPrimaryDeleted?.()

    const result = { ...primary, primary_deleted: true, primary_already_missing: primaryAlreadyMissing }
    if (!autoCleanup) return result

    const cleanup = await runDnsSideEffect(() => this.cleanupCname(providerId, domainName, cname))
    return {
      ...result,
      side_effects: buildDnsSideEffects({ cleanup: toCleanupSideEffect(cleanup, '已执行 DNS 清理') }),
    }
  }

  async repairDomainDns(providerId: string, zoneId: string, domainName: string): Promise<Record<string, unknown>> {
    const cname = await this.domains.assignedCname(providerId, zoneId, domainName, true)
    if (cname === '') throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME not available yet', 422)

    const sync = await runDnsSideEffect(() => this.syncCname(providerId, domainName, cname))
    return { ...sync, side_effects: buildDnsSideEffects({ sync: toSyncSideEffect(sync, '已修复域名解析') }) }
  }

  private async resolveDnsTarget(providerId: string, domainName: string) {
    const fqdn = normalizeFqdn(domainName)
    if (fqdn === '') throw new ApiError('validation_failed', 'Domain name is required', 422)
    const dnspodProviderId = await this.dns.requireDnsPodProviderId(providerId, 'edgeone', 'EdgeOne')
    const dnspodZone = await this.dns.resolveDnsPodZone(dnspodProviderId, fqdn, 'edgeone')
    return { fqdn, dnspodProviderId, dnspodZone }
  }

  /** 在关联 DNSPod 写入默认线路 CNAME */
  private async syncCname(providerId: string, domainName: string, cname: string) {
    if (cname === '') throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME is empty', 422)
    const { fqdn, dnspodProviderId, dnspodZone } = await this.resolveDnsTarget(providerId, domainName)
    const precleaned = await this.dns.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
    const record = await this.dns.sync(dnspodProviderId, dnspodZone, edgeOneCnameRecord(fqdn, cname, dnspodProviderId))
    return { domain_name: fqdn, dnspod_zone: dnspodZone, precleaned, record }
  }

  /** 删除关联 DNSPod 的默认线路 CNAME；未知目标时按名称删除 */
  private async cleanupCname(providerId: string, domainName: string, cname: string) {
    const dnspodProviderId = await this.dns.lookupDnsPodProviderId(providerId, 'edgeone', 'EdgeOne')
    if (dnspodProviderId === '') return { cleaned: 0, records: [], reason: 'dnspod_provider_missing' }

    const fqdn = normalizeFqdn(domainName)
    let dnspodZone: string
    try {
      dnspodZone = await this.dns.resolveDnsPodZone(dnspodProviderId, fqdn, 'edgeone')
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'edgeone_dnspod_zone_not_found')) throw error
      return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
    }

    const records =
      cname !== ''
        ? [await this.dns.delete(dnspodProviderId, dnspodZone, edgeOneCnameRecord(fqdn, cname, dnspodProviderId))]
        : await this.dns.deleteRecordsByNameType(
            dnspodProviderId,
            dnspodZone,
            fqdn,
            'CNAME',
            DNSPOD_DEFAULT_LINE,
            // 只清理本流程写入的记录，避免误删人工 CNAME
            edgeOneCnameRecord(fqdn, cname, dnspodProviderId).remark
          )
    return {
      cleaned: records.filter((record) => record.status === 'deleted').length,
      dnspod_zone: dnspodZone,
      records,
    }
  }
}

function edgeOneCnameRecord(fqdn: string, cname: string, dnspodProviderId: string) {
  return {
    type: 'CNAME',
    name: fqdn,
    value: cname,
    line: DNSPOD_DEFAULT_LINE,
    purpose: 'edgeone_cname',
    provider_id: dnspodProviderId,
    remark: `EdgeOne 加速丨${fqdn}`,
  }
}

function isEdgeOneNotFound(error: unknown): boolean {
  return isExplicitNotFound(error, {
    localCodes: ['edgeone_acceleration_domain_not_found'],
    providerCode: /^ResourceNotFound(?:\.|$)/i,
  })
}
