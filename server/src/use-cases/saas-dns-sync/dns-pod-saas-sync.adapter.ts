import { ApiError } from '../../kernel/http/api-error.js'
import { DNSPOD_DEFAULT_LINE } from '../../domains/dnspod/dns-pod-record.service.js'
import type { DnsPodRecordSyncService, DnsPodSyncRecord } from '../../domains/dnspod/dns-pod-record-sync.service.js'
import type { CloudflareCustomHostname } from '../../domains/cloudflare/saas/saas-custom-hostname.client.js'
import { isHostnameActive } from '../../domains/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../domains/cloudflare/saas/saas-hostname.service.js'
import {
  DNSPOD_ORIGIN_LABEL,
  countDeleted,
  dcvDelegationRecords,
  deleteRemovedSyncRecords,
  ownershipRecord,
  ownershipTxtName,
  requireBusinessTarget,
  requireFqdn,
  resolveEffectiveOrigin,
  syncRecordIdentity,
  syncRemark,
  withSyncPurpose,
  type SaaSSyncAdapter,
  type SyncRecord,
} from './saas-sync-records.js'

/** DNSPod 分线路：默认线路指向业务回源，境内线路指向优选域名 */
export const DNSPOD_PREFERRED_LINE = '境内'

type Target = { dnspodProviderId: string; dnspodZone: string }

/** SaaS 主机名 → DNSPod 解析同步 */
export class DnsPodSaaSSyncAdapter implements SaaSSyncAdapter {
  constructor(
    private readonly hostnames: SaaSHostnameService,
    private readonly dns: DnsPodRecordSyncService
  ) {}

  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}) {
    const fqdn = hostnameFqdn.trim()
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)
    const dnspodProviderId =
      String(data.sync_provider_id ?? '').trim() || (await this.dns.requireDnsPodProviderId(providerId, 'saas', 'SaaS'))
    const dnspodZone = await this.resolveZone(providerId, dnspodProviderId, fqdn, String(data.sync_zone ?? ''))
    return { dnspod_provider_id: dnspodProviderId, dnspod_zone: dnspodZone, hostname_fqdn: fqdn }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = requireFqdn(hostname)
    const target = await this.requireTarget(providerId, hostname, fqdn)
    const origin = requireBusinessTarget(await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname))

    const records = buildRecords(hostname, origin, target)
    const precleaned = await this.dns.precleanConflicts(target.dnspodProviderId, target.dnspodZone, fqdn)
    const results = await this.syncAll(target, records)
    return { hostname_fqdn: fqdn, hostname: fqdn, dnspod_zone: target.dnspodZone, precleaned, records: results }
  }

  async resyncAfterUpdate(providerId: string, cfZoneName: string, hostnameFqdn: string, beforeRecords: SyncRecord[]) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = requireFqdn(hostname)
    const target = await this.optionalTarget(providerId, hostname, fqdn)
    if ('reason' in target) return { cleaned: 0, records: [], deleted: [], reason: target.reason }

    const origin = requireBusinessTarget(await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname))
    const afterRecords = buildRecords(hostname, origin, target)
    const deleted = await deleteRemovedSyncRecords(
      beforeRecords,
      afterRecords,
      (record) => syncRecordIdentity(record, DNSPOD_DEFAULT_LINE),
      (record) => this.dns.delete(target.dnspodProviderId, target.dnspodZone, record)
    )
    const precleaned =
      afterRecords.length === 0
        ? []
        : await this.dns.precleanConflicts(target.dnspodProviderId, target.dnspodZone, fqdn)
    const results = await this.syncAll(target, afterRecords)
    return {
      hostname: fqdn,
      dnspod_zone: target.dnspodZone,
      cleaned: countDeleted(deleted),
      deleted,
      precleaned,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: SyncRecord[]) {
    const dnspodProviderId = String(records[0]?.provider_id ?? '').trim()
    if (records.length === 0 || hostnameFqdn === '' || dnspodProviderId === '') return { cleaned: 0, records: [] }

    let dnspodZone = String(records[0]?.dnspod_zone ?? '').trim()
    if (dnspodZone === '') {
      const zone = await this.optionalZone(providerId, dnspodProviderId, hostnameFqdn)
      if (zone === null) return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
      dnspodZone = zone
    }
    const results = await Promise.all(
      records.map((record) => withSyncPurpose(record, this.dns.delete(dnspodProviderId, dnspodZone, record)))
    )
    return { cleaned: countDeleted(results), dnspod_zone: dnspodZone, records: results }
  }

  /** 主机名激活后删除所有权验证 TXT */
  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }
    if (!hostname.hostname) return { cleaned: 0, reason: 'fqdn_missing' }

    const target = await this.optionalTarget(providerId, hostname, hostname.hostname)
    if ('reason' in target) return { cleaned: 0, reason: target.reason }
    const deleted = await this.dns.deleteRecordsByNameType(
      target.dnspodProviderId,
      target.dnspodZone,
      ownershipTxtName(hostname.hostname),
      'TXT',
      DNSPOD_DEFAULT_LINE
    )
    return { cleaned: countDeleted(deleted), dnspod_zone: target.dnspodZone, records: deleted }
  }

  /** 收集当前应存在的全部记录（删除/更新前快照） */
  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = hostname.hostname
    const dnspodProviderId = await this.dnspodProviderIdOf(providerId, hostname)
    const dnspodZone =
      fqdn && dnspodProviderId ? ((await this.optionalZone(providerId, dnspodProviderId, fqdn)) ?? '') : ''
    const origin = await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname)
    return { hostname_fqdn: fqdn, records: buildRecords(hostname, origin, { dnspodProviderId, dnspodZone }, true) }
  }

  private syncAll(target: Target, records: DnsPodSyncRecord[]) {
    return Promise.all(
      records.map((record) =>
        withSyncPurpose(record, this.dns.sync(target.dnspodProviderId, target.dnspodZone, record))
      )
    )
  }

  private async dnspodProviderIdOf(providerId: string, hostname: CloudflareCustomHostname): Promise<string> {
    return String(hostname.sync_provider_id ?? '').trim() || this.dns.lookupDnsPodProviderId(providerId, 'saas', 'SaaS')
  }

  private async requireTarget(providerId: string, hostname: CloudflareCustomHostname, fqdn: string): Promise<Target> {
    const dnspodProviderId = await this.dnspodProviderIdOf(providerId, hostname)
    if (dnspodProviderId === '') {
      throw new ApiError('saas_dnspod_provider_missing', 'SaaS provider is not linked to a DNSPod provider', 422)
    }
    return { dnspodProviderId, dnspodZone: await this.resolveZone(providerId, dnspodProviderId, fqdn) }
  }

  /** 解析同步目标；未关联服务商或找不到域名时返回跳过原因 */
  private async optionalTarget(
    providerId: string,
    hostname: CloudflareCustomHostname,
    fqdn: string
  ): Promise<Target | { reason: string }> {
    const dnspodProviderId = await this.dnspodProviderIdOf(providerId, hostname)
    if (dnspodProviderId === '') return { reason: 'dnspod_provider_missing' }
    const dnspodZone = await this.optionalZone(providerId, dnspodProviderId, fqdn)
    return dnspodZone === null ? { reason: 'dnspod_zone_not_found' } : { dnspodProviderId, dnspodZone }
  }

  private async optionalZone(providerId: string, dnspodProviderId: string, fqdn: string): Promise<string | null> {
    try {
      return await this.resolveZone(providerId, dnspodProviderId, fqdn)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'saas_dnspod_zone_not_found') return null
      throw error
    }
  }

  /**
   * 显式同步站点优先，否则按最长后缀匹配。
   * 显式值可能来自旧版猜测或账号变更（例如 example.co.uk），
   * 此时回退到权威匹配，避免整段同步被跳过。
   */
  private async resolveZone(providerId: string, dnspodProviderId: string, fqdn: string, explicitZone = '') {
    const zone = explicitZone.trim() || (await this.hostnames.syncConfig(providerId, fqdn)).sync_zone
    if (zone) {
      try {
        return await this.dns.requireExplicitDnsPodZone(dnspodProviderId, zone, 'saas')
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'saas_dnspod_zone_not_found')) throw error
        // 显式站点在账号中不存在：改用最长后缀匹配
      }
    }
    return this.dns.resolveDnsPodZone(dnspodProviderId, fqdn, 'saas')
  }
}

/**
 * 生成主机名应有的 DNSPod 记录。
 * includeAll：用于清理快照，强制包含所有权 TXT（即使已激活）。
 */
function buildRecords(
  hostname: CloudflareCustomHostname,
  origin: string,
  target: Target,
  includeAll = false
): DnsPodSyncRecord[] {
  const fqdn = hostname.hostname
  if (!fqdn) return []
  const record = (type: string, name: string, value: string, purpose: string, line = DNSPOD_DEFAULT_LINE) => ({
    type,
    name,
    value,
    line,
    purpose,
    provider_id: target.dnspodProviderId,
    dnspod_zone: target.dnspodZone,
    remark: syncRemark(purpose, fqdn, DNSPOD_ORIGIN_LABEL),
  })

  const records: DnsPodSyncRecord[] = []
  if (origin) records.push(record('CNAME', fqdn, origin, 'origin_cname'))

  const preferred = String(hostname.custom_metadata?.preferred_domain ?? '').trim()
  if (hostname.auto_preferred && preferred) {
    records.push(record('CNAME', fqdn, preferred, 'preferred_cname', DNSPOD_PREFERRED_LINE))
  }
  for (const dcv of dcvDelegationRecords(hostname)) records.push(record('CNAME', dcv.name, dcv.value, 'dcv_delegation'))

  // 已激活的主机名不再写入所有权 TXT
  if (includeAll || !isHostnameActive(hostname)) {
    const ownership = ownershipRecord(hostname, includeAll)
    if (ownership) records.push(record('TXT', ownership.name, ownership.value, 'ownership_verification'))
  }
  return records
}
