import { ApiError } from '../../kernel/http/api-error.js'
import { runStages, type Stage, type StageLifecycle } from '../../kernel/jobs/stage-runner.js'
import { normalizeFqdn } from '../../lib/values.js'
import { isExplicitNotFound } from '../../kernel/providers/provider-error.js'
import {
  buildDnsSideEffects,
  runDnsSideEffect,
  toCleanupSideEffect,
  toSyncSideEffect,
} from '../../kernel/providers/side-effect-result.js'
import type { DnsPodAccess } from '../../domains/dnspod/access.js'
import type { DnsPodZoneCatalog } from '../../domains/dnspod/zone-catalog.js'
import type { DnsWriter } from '../derived-records/dns-writer.js'
import { edgeOneCnameDesired } from '../derived-records/planners/edgeone.planner.js'
import type { EdgeOneDomainService } from '../../domains/edgeone/edge-one-domain.service.js'
import { normalizeAccelerationDomainPayload } from '../../domains/edgeone/edge-one-domain-payload.js'
import { invalidateEdgeOneDomainCache } from '../../domains/edgeone/edge-one.cache.js'
import { dnsZoneKey, edgeOneZoneKey } from '../../kernel/jobs/job-types.js'

/** 删除加速域名的阶段序列（顺序不可逆；重试从第一个未完成阶段继续） */
const EDGEONE_DELETE_STAGES = ['primary-deleted'] as const
export type EdgeOneDeleteStage = (typeof EDGEONE_DELETE_STAGES)[number]

/** 阶段 → 任务条目上的完成判定（记录由本工作流写入，批量任务据此恢复推进点） */
const deleteStageRecorded: Record<EdgeOneDeleteStage, (item: Record<string, unknown>) => boolean> = {
  'primary-deleted': (item) => item.primary_deleted === true,
}

/** 任务条目 → 已完成阶段（批量任务重试时据此跳过已完成阶段） */
export function completedEdgeOneDeleteStages(item: Record<string, unknown>): EdgeOneDeleteStage[] {
  return EDGEONE_DELETE_STAGES.filter((stage) => deleteStageRecorded[stage](item))
}

type DeleteOptions = StageLifecycle<EdgeOneDeleteStage> & {
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
    /** 关联 DNSPod 账号解析（D3-2 底座） */
    private readonly access: DnsPodAccess,
    /** FQDN → DNSPod 域名 解析（D3-2 底座） */
    private readonly catalog: DnsPodZoneCatalog,
    private readonly writer: DnsWriter
  ) {}

  /**
   * 本工作流会写入的底层资源：EdgeOne 站点 + 各加速域名对应的 DNSPod 域名。
   * 用于与 DNS 批量等任务做跨工作流互斥。
   */
  async resourceKeys(providerId: string, zoneId: string, domains: string[]): Promise<string[]> {
    const keys = [edgeOneZoneKey(providerId, zoneId)]
    const dnspodProviderId = await this.access.linkedProviderId(providerId, 'edgeone', 'EdgeOne').catch(() => '')
    if (!dnspodProviderId) return keys
    for (const domain of new Set(domains.map((item) => normalizeFqdn(item)))) {
      if (domain === '') continue
      const zone = await this.catalog.match(dnspodProviderId, domain).catch(() => '')
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

  /**
   * 删除加速域名：按显式阶段推进（记录 CNAME → 删除远端域名 → 清理 DNSPod CNAME）。
   * 重试跳过已完成的远端删除，只补做 DNS 清理。
   */
  async deleteAccelerationDomain(
    providerId: string,
    zoneId: string,
    domainName: string,
    autoCleanup = false,
    options: DeleteOptions = {}
  ): Promise<Record<string, unknown>> {
    const completed = new Set(options.completed ?? [])

    // 删除前记录 CNAME，清理时只删指向 EdgeOne 的记录
    let cname = options.cname ?? ''
    if (autoCleanup && !completed.has('primary-deleted') && options.cname === undefined) {
      cname = await this.domains.assignedCname(providerId, zoneId, domainName).catch((error: unknown) => {
        if (!isEdgeOneNotFound(error)) throw error
        return ''
      })
    }

    let primary: Record<string, unknown> = { name: domainName }
    let primaryAlreadyMissing = false
    const stages: Array<Stage<EdgeOneDeleteStage>> = [
      {
        name: 'primary-deleted',
        run: async () => {
          try {
            primary = await this.domains.deleteAccelerationDomain(providerId, zoneId, domainName)
          } catch (error) {
            if (!isEdgeOneNotFound(error)) throw error
            primaryAlreadyMissing = true
            invalidateEdgeOneDomainCache(providerId, zoneId)
          }
          return { primary_deleted: true }
        },
      },
    ]
    await runStages(stages, options)

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
    const dnspodProviderId = await this.access.requireLinkedProviderId(providerId, 'edgeone', 'EdgeOne')
    const dnspodZone = await this.catalog.resolve(dnspodProviderId, fqdn, 'edgeone')
    return { fqdn, dnspodProviderId, dnspodZone }
  }

  /** 在关联 DNSPod 写入默认线路 CNAME */
  private async syncCname(providerId: string, domainName: string, cname: string) {
    if (cname === '') throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME is empty', 422)
    const { fqdn, dnspodProviderId, dnspodZone } = await this.resolveDnsTarget(providerId, domainName)
    const precleaned = await this.writer.preclean(
      'dnspod',
      dnspodProviderId,
      dnspodZone,
      { fqdn, type: 'CNAME' },
      'edgeone'
    )
    const [record] = await this.writer.sync('dnspod', dnspodProviderId, dnspodZone, [edgeOneCnameDesired(fqdn, cname)])
    return { domain_name: fqdn, dnspod_zone: dnspodZone, precleaned, record }
  }

  /** 删除关联 DNSPod 的默认线路 CNAME；域名已删除时靠显式来源声明 + 值/备注证据通过归属校验 */
  private async cleanupCname(providerId: string, domainName: string, cname: string) {
    const dnspodProviderId = await this.access.linkedProviderId(providerId, 'edgeone', 'EdgeOne')
    if (dnspodProviderId === '') return { cleaned: 0, records: [], reason: 'dnspod_provider_missing' }

    const fqdn = normalizeFqdn(domainName)
    let dnspodZone: string
    try {
      dnspodZone = await this.catalog.resolve(dnspodProviderId, fqdn, 'edgeone')
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'edgeone_dnspod_zone_not_found')) throw error
      return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
    }

    // 只清理本流程写入的记录（值或备注可证明归属），避免误删人工 CNAME
    const records = await this.writer.sync('dnspod', dnspodProviderId, dnspodZone, [
      { ...edgeOneCnameDesired(fqdn, cname), keep: false },
    ])
    return {
      cleaned: records.filter((record) => record.status === 'deleted').length,
      dnspod_zone: dnspodZone,
      records,
    }
  }
}

function isEdgeOneNotFound(error: unknown): boolean {
  return isExplicitNotFound(error, {
    localCodes: ['edgeone_acceleration_domain_not_found'],
    providerCode: /^ResourceNotFound(?:\.|$)/i,
  })
}
