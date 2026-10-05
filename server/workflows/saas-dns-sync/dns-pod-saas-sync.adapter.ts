import { ApiError } from '../../core/http/api-error.js'
import type { DnsZoneCatalogPort } from '../../core/contracts/dns-zone-catalog.port.js'
import type { LinkedDnsAccountPort } from '../../core/contracts/linked-dns-account.port.js'
import type { SaaSHostnameValue } from '../../core/contracts/saas-hostname.port.js'
import type { DnsWriter } from '../derived-records/dns-writer.js'
import {
  DNSPOD_DEFAULT_LINE,
  DNSPOD_ORIGIN_LABEL,
  DNSPOD_RECORD_TTL,
  cleanupDesired,
  countDeleted,
  desiredRecord,
  optionalDnsPodSaasTarget,
  ownershipTxtName,
  requireBusinessTarget,
  requireFqdn,
  resolveDnsPodSaasTarget,
  resolveEffectiveOrigin,
  saasDnsPodProviderId,
  syncRemark,
  type SaaSPlannerHostnames,
  type SaaSDnsPodTargetDeps,
  type SaaSSyncRecord,
} from '../derived-records/planners/saas.planner.js'
import { deleteRemovedRecords, saasTargetRecords, type SaaSSyncAdapter } from './saas-sync-records.js'

/** SaaS 主机名 → DNSPod 解析同步 */
export class DnsPodSaaSSyncAdapter implements SaaSSyncAdapter {
  private readonly target: SaaSDnsPodTargetDeps

  constructor(
    private readonly hostnames: SaaSPlannerHostnames,
    access: LinkedDnsAccountPort,
    catalog: DnsZoneCatalogPort,
    private readonly writer: DnsWriter
  ) {
    this.target = { hostnames, access, catalog }
  }

  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}) {
    const fqdn = hostnameFqdn.trim()
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)
    const target = await resolveDnsPodSaasTarget(
      this.target,
      providerId,
      null,
      fqdn,
      String(data.sync_zone ?? ''),
      String(data.sync_provider_id ?? '')
    )
    return { dnspod_provider_id: target.providerId, dnspod_zone: target.zone, hostname_fqdn: fqdn }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = requireFqdn(hostname)
    const target = await resolveDnsPodSaasTarget(this.target, providerId, hostname, fqdn)
    const origin = requireBusinessTarget(await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname))

    const records = saasTargetRecords('dnspod', hostname, target, origin, this.hostnames)
    const precleaned = await this.writer.preclean(
      'dnspod',
      target.providerId,
      target.zone,
      { fqdn, type: 'CNAME' },
      'saas'
    )
    const results = await this.writer.sync('dnspod', target.providerId, target.zone, records)
    return { hostname_fqdn: fqdn, hostname: fqdn, dnspod_zone: target.zone, precleaned, records: results }
  }

  async resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: SaaSSyncRecord[]
  ) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = requireFqdn(hostname)
    const target = await optionalDnsPodSaasTarget(this.target, providerId, hostname, fqdn)
    if (!target.ok) return { cleaned: 0, records: [], deleted: [], reason: target.reason }

    const origin = requireBusinessTarget(await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname))
    const afterRecords = saasTargetRecords('dnspod', hostname, target, origin, this.hostnames)
    const deleted = await deleteRemovedRecords(this.writer, 'dnspod', target, beforeRecords, afterRecords)
    const precleaned =
      afterRecords.length === 0
        ? []
        : await this.writer.preclean('dnspod', target.providerId, target.zone, { fqdn, type: 'CNAME' }, 'saas')
    const results = await this.writer.sync('dnspod', target.providerId, target.zone, afterRecords)
    return {
      hostname: fqdn,
      dnspod_zone: target.zone,
      cleaned: countDeleted(deleted),
      deleted,
      precleaned,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: SaaSSyncRecord[]) {
    const dnspodProviderId = String(records[0]?.provider_id ?? '').trim()
    if (records.length === 0 || hostnameFqdn === '' || dnspodProviderId === '') return { cleaned: 0, records: [] }

    let dnspodZone = String(records[0]?.zone ?? '').trim()
    if (dnspodZone === '') {
      // 主机名可能已被删除：只按 FQDN 解析站点（显式 provider 来自清理配方）
      const resolved = await resolveDnsPodSaasTarget(this.target, providerId, null, hostnameFqdn, '', dnspodProviderId)
        .then((target) => target.zone)
        .catch(() => '')
      if (resolved === '') return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
      dnspodZone = resolved
    }
    const results = await this.writer.sync('dnspod', dnspodProviderId, dnspodZone, records.map(cleanupDesired))
    return { cleaned: countDeleted(results), dnspod_zone: dnspodZone, records: results }
  }

  /** 主机名激活后删除所有权验证 TXT */
  async cleanupStaleRecords(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    hostname?: SaaSHostnameValue
  ) {
    // 调用方已强制读取过主机名时复用快照，避免同一次对账重复打上游
    const current = hostname ?? (await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true))
    if (!this.hostnames.isHostnameActive(current)) return { cleaned: 0, reason: 'saas_not_active' }
    const fqdn = current.hostname
    if (!fqdn) return { cleaned: 0, reason: 'fqdn_missing' }

    const target = await optionalDnsPodSaasTarget(this.target, providerId, current, fqdn)
    if (!target.ok) return { cleaned: 0, reason: target.reason }
    const deleted = await this.writer.sync('dnspod', target.providerId, target.zone, [
      cleanupDesired(
        desiredRecord({
          fqdn: ownershipTxtName(fqdn),
          purpose: 'ownership_verification',
          refId: fqdn,
          record: {
            type: 'TXT',
            value: '',
            line: DNSPOD_DEFAULT_LINE,
            ttl: DNSPOD_RECORD_TTL,
            note: syncRemark('ownership_verification', fqdn, DNSPOD_ORIGIN_LABEL),
          },
          provider_type: 'dnspod',
          provider_id: target.providerId,
          zone: target.zone,
        })
      ),
    ])
    return { cleaned: countDeleted(deleted), dnspod_zone: target.zone, records: deleted }
  }

  /** 收集当前应存在的全部记录（删除/更新前快照） */
  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = hostname.hostname
    if (!fqdn) return { hostname_fqdn: '', records: [] }

    const dnspodProviderId = await saasDnsPodProviderId(this.target, providerId, hostname).catch(() => '')
    // 未关联 DNSPod 服务商：目标不可解析，返回空快照，避免清理配方携带 provider/zone 全空的记录
    if (dnspodProviderId === '') return { hostname_fqdn: fqdn, records: [] }

    const target = await optionalDnsPodSaasTarget(this.target, providerId, hostname, fqdn)
    // 域名未匹配到 DNSPod 站点：同样返回空快照，不写入无站点归属的记录
    if (!target.ok) return { hostname_fqdn: fqdn, records: [] }
    const origin = await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname)
    return { hostname_fqdn: fqdn, records: saasTargetRecords('dnspod', hostname, target, origin, this.hostnames, true) }
  }
}
