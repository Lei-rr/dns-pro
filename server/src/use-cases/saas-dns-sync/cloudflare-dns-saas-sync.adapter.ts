import { ApiError } from '../../kernel/http/api-error.js'
import type { CloudflareZoneService } from '../../domains/cloudflare/cloudflare-zone.service.js'
import type { CloudflareCustomHostname } from '../../domains/cloudflare/saas/saas-custom-hostname.client.js'
import { isHostnameActive } from '../../domains/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../domains/cloudflare/saas/saas-hostname.service.js'
import type { SaaSSyncConfigService } from '../../domains/cloudflare/saas/saas-sync-config.service.js'
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
  saasDesiredRecords,
  syncRecordIdentity,
  syncRemark,
  type CloudflareSaasTarget,
  type SaaSSyncRecord,
  type SaaSSyncTargetDeps,
} from '../derived-records/planners/saas.planner.js'
import type { SaaSSyncAdapter } from './saas-sync-records.js'

/** Cloudflare 同步记录 TTL：1 表示自动 */
const SAAS_RECORD_TTL = 1

/**
 * SaaS 主机名 → Cloudflare DNS 同步。
 * Cloudflare 无线路拆分：业务 CNAME 有优选用优选，否则用回源；同步时不写所有权 TXT（同站点通常自动验证）。
 */
export class CloudflareDnsSaaSSyncAdapter implements SaaSSyncAdapter {
  private readonly target: SaaSSyncTargetDeps

  constructor(
    private readonly hostnames: SaaSHostnameService,
    syncConfigs: SaaSSyncConfigService,
    zones: CloudflareZoneService,
    private readonly writer: DnsWriter
  ) {
    this.target = { hostnames, syncConfigs, cloudflareZones: zones }
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
    const records = this.records(hostname, await this.businessTarget(providerId, cfZoneName, hostname, true), target)
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
    const afterRecords = this.records(
      hostname,
      await this.businessTarget(providerId, cfZoneName, hostname, true),
      target
    )
    const deleted = await this.deleteRemoved(target, beforeRecords, afterRecords)
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
  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }
    const fqdn = hostname.hostname
    if (!fqdn) return { cleaned: 0, reason: 'fqdn_missing' }

    const target = await resolveCloudflareSaasTarget(this.target, providerId, fqdn, { cfZoneName })
    const results = await this.writer.sync('cloudflare', target.providerId, target.zone, [
      cleanupDesired(
        desiredRecord({
          fqdn: ownershipTxtName(fqdn),
          purpose: 'ownership_verification',
          record: {
            type: 'TXT',
            value: String(hostname.ownership_verification?.value ?? ''),
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
      records: saasDesiredRecords({
        hostname,
        providerType: 'cloudflare',
        providerId: sync.sync_provider_id || (await this.defaultDnsProviderId(providerId)),
        zone: sync.sync_zone,
        origin: business,
        includeAll: true,
      }),
    }
  }

  /** 更新后不再需要的记录：按身份差集一次清理（值或备注可证明归属） */
  private async deleteRemoved(
    target: CloudflareSaasTarget,
    beforeRecords: SaaSSyncRecord[],
    afterRecords: SaaSSyncRecord[]
  ) {
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
    return this.writer.sync('cloudflare', target.providerId, target.zone, orphans)
  }

  /** 业务 CNAME 目标：优选域名 > 自定义回源 > 默认回源 */
  private async businessTarget(
    providerId: string,
    cfZoneName: string,
    hostname: CloudflareCustomHostname,
    required: boolean
  ) {
    const preferred = String(hostname.custom_metadata?.preferred_domain ?? hostname.preferred_domain ?? '').trim()
    const target = preferred || (await resolveEffectiveOrigin(this.hostnames, providerId, cfZoneName, hostname))
    return required ? requireBusinessTarget(target) : target
  }

  /** 期望记录：写入与对账共用 saasDesiredRecords（单一来源） */
  private records(
    hostname: CloudflareCustomHostname,
    business: string,
    target: CloudflareSaasTarget,
    includeAll = false
  ): SaaSSyncRecord[] {
    return saasDesiredRecords({
      hostname,
      providerType: 'cloudflare',
      providerId: target.providerId,
      zone: target.zone,
      origin: business,
      includeAll,
    })
  }

  private async defaultDnsProviderId(providerId: string): Promise<string> {
    return saasDefaultCloudflareProviderId(this.target, providerId)
  }
}
