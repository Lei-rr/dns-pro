import { ApiError } from '../../core/http/api-error.js'
import type { CloudflareZonePort } from '../../core/contracts/cloudflare-zone.port.js'
import type { SaaSHostnameValue } from '../../core/contracts/saas-hostname.port.js'
import type { SaaSSyncDefaultsPort } from '../../core/contracts/saas-sync-config.port.js'
import type { DnsWriter } from '../derived-records/dns-writer.js'
import {
  CLOUDFLARE_ORIGIN_LABEL,
  cleanupDesired,
  countDeleted,
  desiredRecord,
  ownershipTxtName,
  requireBusinessTarget,
  requireFqdn,
  resolveCloudflareSaasTarget,
  resolveEffectiveOrigin,
  saasDefaultCloudflareProviderId,
  syncRemark,
  type SaaSPlannerHostnames,
  type SaaSSyncRecord,
  type SaaSSyncTargetDeps,
} from '../derived-records/planners/saas.planner.js'
import { deleteRemovedRecords, saasTargetRecords, type SaaSSyncAdapter } from './saas-sync-records.js'

/** Cloudflare 同步记录 TTL：1 表示自动 */
const SAAS_RECORD_TTL = 1

/**
 * SaaS 主机名 → Cloudflare DNS 同步。
 * Cloudflare 无线路拆分：业务 CNAME 有优选用优选，否则用回源；同步时不写所有权 TXT（同站点通常自动验证）。
 */
export class CloudflareDnsSaaSSyncAdapter implements SaaSSyncAdapter {
  private readonly target: SaaSSyncTargetDeps

  constructor(
    private readonly hostnames: SaaSPlannerHostnames,
    syncDefaults: SaaSSyncDefaultsPort,
    zones: CloudflareZonePort,
    private readonly writer: DnsWriter
  ) {
    this.target = { hostnames, syncDefaults, cloudflareZones: zones }
  }

  /** 创建前预检：主机名尚未创建，不查询其偏好 */
  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}) {
    const target = await resolveCloudflareSaasTarget(this.target, providerId, hostnameFqdn, {
      zone: String(data.sync_zone ?? ''),
      provider: String(data.sync_provider_id ?? ''),
      skipHostnameConfig: true,
    })
    return {
      cloudflare_provider_id: target.providerId,
      cloudflare_zone_id: target.zoneId,
      cloudflare_zone: target.zone,
      hostname_fqdn: hostnameFqdn.trim(),
    }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const target = await resolveCloudflareSaasTarget(this.target, providerId, hostnameFqdn, { cfZoneName })
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = requireFqdn(hostname)
    const records = saasTargetRecords(
      'cloudflare',
      hostname,
      target,
      await this.businessTarget(providerId, cfZoneName, hostname, true),
      this.hostnames
    )
    const results = await this.writer.sync('cloudflare', target.providerId, target.zone, records)
    return {
      hostname_fqdn: fqdn,
      hostname: fqdn,
      cloudflare_provider_id: target.providerId,
      cloudflare_zone: target.zone,
      records: results,
    }
  }

  async resyncAfterUpdate(
    providerId: string,
    cfZoneName: string,
    hostnameFqdn: string,
    beforeRecords: SaaSSyncRecord[]
  ) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = requireFqdn(hostname)
    const target = await resolveCloudflareSaasTarget(this.target, providerId, fqdn)
    const afterRecords = saasTargetRecords(
      'cloudflare',
      hostname,
      target,
      await this.businessTarget(providerId, cfZoneName, hostname, true),
      this.hostnames
    )
    const deleted = await deleteRemovedRecords(this.writer, 'cloudflare', target, beforeRecords, afterRecords)
    const results = await this.writer.sync('cloudflare', target.providerId, target.zone, afterRecords)
    return {
      hostname_fqdn: fqdn,
      cloudflare_zone: target.zone,
      cleaned: countDeleted(deleted),
      deleted,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: SaaSSyncRecord[]) {
    if (records.length === 0 || hostnameFqdn === '') return { cleaned: 0, records: [] }
    const zoneName = String(records[0]?.zone ?? '').trim()
    if (zoneName === '') return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }
    const cloudflareProviderId =
      String(records[0]?.provider_id ?? '').trim() || (await this.defaultDnsProviderId(providerId))

    try {
      await this.target.cloudflareZones.idByName(cloudflareProviderId, zoneName)
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'cloudflare_zone_not_found')) throw error
      return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }
    }
    const results = await this.writer.sync('cloudflare', cloudflareProviderId, zoneName, records.map(cleanupDesired))
    return { cleaned: countDeleted(results), cloudflare_zone: zoneName, records: results }
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

    const target = await resolveCloudflareSaasTarget(this.target, providerId, fqdn, { cfZoneName })
    const results = await this.writer.sync('cloudflare', target.providerId, target.zone, [
      cleanupDesired(
        desiredRecord({
          fqdn: ownershipTxtName(fqdn),
          purpose: 'ownership_verification',
          // 该记录所属主机名（D4 门禁按来源放行无主记录）
          refId: fqdn,
          record: {
            type: 'TXT',
            value: String(current.ownership_verification?.value ?? ''),
            ttl: SAAS_RECORD_TTL,
            note: syncRemark('ownership_verification', fqdn, CLOUDFLARE_ORIGIN_LABEL),
          },
          provider_type: 'cloudflare',
          provider_id: target.providerId,
          zone: target.zone,
        })
      ),
    ])
    return { cleaned: countDeleted(results), cloudflare_zone: target.zone, records: results }
  }

  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const sync = await this.hostnames.syncConfig(providerId, hostname.hostname, cfZoneName)
    const business = await this.businessTarget(providerId, cfZoneName, hostname, false)
    return {
      hostname_fqdn: hostname.hostname,
      records: saasTargetRecords(
        'cloudflare',
        hostname,
        { providerId: sync.sync_provider_id || (await this.defaultDnsProviderId(providerId)), zone: sync.sync_zone },
        business,
        this.hostnames,
        true
      ),
    }
  }

  /** 业务 CNAME 目标：优选域名 > 自定义回源 > 默认回源 */
  private async businessTarget(providerId: string, cfZoneName: string, hostname: SaaSHostnameValue, required: boolean) {
    const preferred = this.hostnames.effectivePreferredDomain(hostname)
    const target = preferred || (await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname))
    return required ? requireBusinessTarget(target) : target
  }

  private async defaultDnsProviderId(providerId: string): Promise<string> {
    return saasDefaultCloudflareProviderId(this.target, providerId)
  }
}
