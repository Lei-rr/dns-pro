import { ApiError } from '../../core/http/api-error.js'
import { DNSPOD_DEFAULT_LINE } from '../../modules/dnspod/dns-pod-record.service.js'
import type { DnsPodAccess } from '../../modules/dnspod/access.js'
import type { DnsPodZoneCatalog } from '../../modules/dnspod/zone-catalog.js'
import type { CloudflareCustomHostname } from '../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import { isHostnameActive } from '../../modules/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../modules/cloudflare/saas/saas-hostname.service.js'
import type { DnsWriter } from '../derived-records/dns-writer.js'
import {
  DNSPOD_ORIGIN_LABEL,
  DNSPOD_PREFERRED_LINE,
  cleanupDesired,
  countDeleted,
  desiredRecord,
  optionalDnsPodSaasTarget,
  ownershipTxtName,
  requireBusinessTarget,
  requireFqdn,
  resolveDnsPodSaasTarget,
  resolveEffectiveOrigin,
  saasDesiredRecords,
  saasDnsPodProviderId,
  syncRecordIdentity,
  syncRemark,
  type SaaSDnsPodTargetDeps,
  type SaaSDnsTarget,
  type SaaSSyncRecord,
} from '../derived-records/planners/saas.planner.js'
import type { SaaSSyncAdapter } from './saas-sync-records.js'

export { DNSPOD_PREFERRED_LINE }

/** DNSPod 同步记录 TTL（沿用历史默认值） */
const SAAS_RECORD_TTL = 600

/** SaaS 主机名 → DNSPod 解析同步 */
export class DnsPodSaaSSyncAdapter implements SaaSSyncAdapter {
  private readonly target: SaaSDnsPodTargetDeps

  constructor(
    private readonly hostnames: SaaSHostnameService,
    access: DnsPodAccess,
    catalog: DnsPodZoneCatalog,
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

    const records = this.records(hostname, origin, target)
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
    if ('reason' in target) return { cleaned: 0, records: [], deleted: [], reason: target.reason }

    const origin = requireBusinessTarget(await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname))
    const afterRecords = this.records(hostname, origin, target)
    const deleted = await this.deleteRemoved(target, beforeRecords, afterRecords)
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
  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }
    const fqdn = hostname.hostname
    if (!fqdn) return { cleaned: 0, reason: 'fqdn_missing' }

    const target = await optionalDnsPodSaasTarget(this.target, providerId, hostname, fqdn)
    if ('reason' in target) return { cleaned: 0, reason: target.reason }
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
            ttl: SAAS_RECORD_TTL,
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
    const dnspodProviderId = await saasDnsPodProviderId(this.target, providerId, hostname).catch(() => '')
    const target = fqdn ? await optionalDnsPodSaasTarget(this.target, providerId, hostname, fqdn) : { reason: '' }
    const resolved: SaaSDnsTarget =
      'reason' in target ? { providerType: 'dnspod', providerId: dnspodProviderId, zone: '' } : target
    const origin = await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname)
    return { hostname_fqdn: fqdn, records: this.records(hostname, origin, resolved, true) }
  }

  /** 期望记录：写入与对账共用 saasDesiredRecords（单一来源） */
  private records(
    hostname: CloudflareCustomHostname,
    origin: string,
    target: SaaSDnsTarget,
    includeAll = false
  ): SaaSSyncRecord[] {
    return saasDesiredRecords({
      hostname,
      providerType: 'dnspod',
      providerId: target.providerId,
      zone: target.zone,
      origin,
      includeAll,
    })
  }

  /** 更新后不再需要的记录：按身份差集一次清理（值或备注可证明归属） */
  private async deleteRemoved(target: SaaSDnsTarget, beforeRecords: SaaSSyncRecord[], afterRecords: SaaSSyncRecord[]) {
    const retained = new Set(afterRecords.map(syncRecordIdentity))
    const seen = new Set<string>()
    const orphans: SaaSSyncRecord[] = []
    for (const record of beforeRecords) {
      const key = syncRecordIdentity(record)
      if (key === '' || seen.has(key) || retained.has(key)) continue
      seen.add(key)
      orphans.push(cleanupDesired(record))
    }
    if (orphans.length === 0) return []
    return this.writer.sync('dnspod', target.providerId, target.zone, orphans)
  }
}
