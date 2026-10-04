import { ApiError } from '../../kernel/http/api-error.js'
import { normalizeFqdn } from '../../lib/values.js'
import type { CloudflareZoneService } from '../../domains/cloudflare/cloudflare-zone.service.js'
import type { CloudflareCustomHostname } from '../../domains/cloudflare/saas/saas-custom-hostname.client.js'
import { isHostnameActive, zoneOwnsHostname } from '../../domains/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../domains/cloudflare/saas/saas-hostname.service.js'
import type { SaaSSyncConfigService } from '../../domains/cloudflare/saas/saas-sync-config.service.js'
import type { DnsWriter } from '../derived-records/dns-writer.js'
import {
  CLOUDFLARE_ORIGIN_LABEL,
  cleanupDesired,
  countDeleted,
  dcvDelegationRecords,
  desiredRecord,
  ownershipRecord,
  ownershipTxtName,
  requireBusinessTarget,
  requireFqdn,
  resolveEffectiveOrigin,
  syncRecordIdentity,
  syncRemark,
  type SaaSSyncAdapter,
  type SaaSSyncRecord,
} from './saas-sync-records.js'

/** Cloudflare 同步记录 TTL：1 表示自动 */
const SAAS_RECORD_TTL = 1

type Target = { cloudflareProviderId: string; zoneId: string; zoneName: string }

/**
 * SaaS 主机名 → Cloudflare DNS 同步。
 * Cloudflare 无线路拆分：业务 CNAME 有优选用优选，否则用回源；同步时不写所有权 TXT（同站点通常自动验证）。
 */
export class CloudflareDnsSaaSSyncAdapter implements SaaSSyncAdapter {
  constructor(
    private readonly hostnames: SaaSHostnameService,
    private readonly syncConfigs: SaaSSyncConfigService,
    private readonly zones: CloudflareZoneService,
    private readonly writer: DnsWriter
  ) {}

  /** 创建前预检：主机名尚未创建，不查询其偏好 */
  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}) {
    const target = await this.resolveTarget(providerId, hostnameFqdn, {
      zone: String(data.sync_zone ?? ''),
      provider: String(data.sync_provider_id ?? ''),
      skipHostnameConfig: true,
    })
    return {
      cloudflare_provider_id: target.cloudflareProviderId,
      cloudflare_zone_id: target.zoneId,
      cloudflare_zone: target.zoneName,
      hostname_fqdn: hostnameFqdn.trim(),
    }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const target = await this.resolveTarget(providerId, hostnameFqdn, { cfZoneName })
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = requireFqdn(hostname)
    const records = buildRecords(hostname, await this.businessTarget(providerId, cfZoneName, hostname, true), target)
    const results = await this.writer.sync('cloudflare', target.cloudflareProviderId, target.zoneName, records)
    return {
      hostname_fqdn: fqdn,
      hostname: fqdn,
      cloudflare_provider_id: target.cloudflareProviderId,
      cloudflare_zone: target.zoneName,
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
    const target = await this.resolveTarget(providerId, fqdn)
    const afterRecords = buildRecords(
      hostname,
      await this.businessTarget(providerId, cfZoneName, hostname, true),
      target
    )
    const deleted = await this.deleteRemoved(target, beforeRecords, afterRecords)
    const results = await this.writer.sync('cloudflare', target.cloudflareProviderId, target.zoneName, afterRecords)
    return {
      hostname_fqdn: fqdn,
      cloudflare_zone: target.zoneName,
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
      await this.zones.idByName(cloudflareProviderId, zoneName)
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

    const target = await this.resolveTarget(providerId, fqdn, { cfZoneName })
    const results = await this.writer.sync('cloudflare', target.cloudflareProviderId, target.zoneName, [
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
          provider_id: target.cloudflareProviderId,
          zone: target.zoneName,
        })
      ),
    ])
    return { cleaned: countDeleted(results), cloudflare_zone: target.zoneName, records: results }
  }

  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const sync = await this.hostnames.syncConfig(providerId, hostname.hostname, cfZoneName)
    const target = {
      cloudflareProviderId: sync.sync_provider_id || (await this.defaultDnsProviderId(providerId)),
      zoneId: '',
      zoneName: sync.sync_zone,
    }
    const business = await this.businessTarget(providerId, cfZoneName, hostname, false)
    return { hostname_fqdn: hostname.hostname, records: buildRecords(hostname, business, target, true) }
  }

  /** 更新后不再需要的记录：按身份差集一次清理（值或备注可证明归属） */
  private async deleteRemoved(target: Target, beforeRecords: SaaSSyncRecord[], afterRecords: SaaSSyncRecord[]) {
    const retained = new Set(afterRecords.map((record) => syncRecordIdentity(record)))
    const seen = new Set<string>()
    const orphans: SaaSSyncRecord[] = []
    for (const record of beforeRecords) {
      const key = syncRecordIdentity(record)
      if (key === '' || seen.has(key) || retained.has(key)) continue
      seen.add(key)
      orphans.push(cleanupDesired(record))
    }
    if (orphans.length === 0) return []
    return this.writer.sync('cloudflare', target.cloudflareProviderId, target.zoneName, orphans)
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

  private async resolveTarget(
    providerId: string,
    hostnameFqdn: string,
    explicit: { zone?: string; provider?: string; skipHostnameConfig?: boolean; cfZoneName?: string } = {}
  ): Promise<Target> {
    const cfZoneName = explicit.cfZoneName ?? ''
    const sync = explicit.skipHostnameConfig ? null : await this.hostnames.syncConfig(providerId, hostnameFqdn)
    const cloudflareProviderId =
      explicit.provider?.trim() || sync?.sync_provider_id || (await this.defaultDnsProviderId(providerId))
    // 未显式配置同步站点时，回退到主机名所在的 Cloudflare 站点（cfZoneName）
    let zoneName = (explicit.zone?.trim() || sync?.sync_zone || '').toLowerCase()
    if (zoneName !== '' && !zoneOwnsHostname(zoneName, hostnameFqdn)) zoneName = ''
    zoneName ||= normalizeFqdn(cfZoneName)
    if (zoneName === '') {
      throw new ApiError('saas_cloudflare_sync_zone_missing', 'Cloudflare DNS sync zone is required', 422)
    }
    // 防止把 api.example.com 写进无关站点
    const fqdn = normalizeFqdn(hostnameFqdn)
    if (!zoneOwnsHostname(zoneName, fqdn)) {
      throw new ApiError(
        'saas_cloudflare_sync_zone_mismatch',
        `Cloudflare DNS sync zone ${zoneName} does not match hostname ${fqdn}`,
        422,
        { hostname: fqdn, sync_zone: zoneName }
      )
    }
    return { cloudflareProviderId, zoneId: await this.zones.idByName(cloudflareProviderId, zoneName), zoneName }
  }

  private async defaultDnsProviderId(providerId: string): Promise<string> {
    const id = await this.syncConfigs.defaultSyncProviderId(providerId, 'cloudflare_dns')
    if (id === '') {
      throw new ApiError(
        'saas_cloudflare_dns_provider_missing',
        'SaaS provider is not linked to a Cloudflare DNS provider',
        422
      )
    }
    return id
  }
}

function buildRecords(
  hostname: CloudflareCustomHostname,
  business: string,
  target: Target,
  includeAll = false
): SaaSSyncRecord[] {
  const fqdn = hostname.hostname
  if (!fqdn) return []
  const record = (type: string, name: string, value: string, purpose: string): SaaSSyncRecord =>
    desiredRecord({
      fqdn: name,
      purpose,
      record: { type, value, ttl: SAAS_RECORD_TTL, note: syncRemark(purpose, fqdn, CLOUDFLARE_ORIGIN_LABEL) },
      provider_type: 'cloudflare',
      provider_id: target.cloudflareProviderId,
      zone: target.zoneName,
    })

  const records: SaaSSyncRecord[] = []
  if (business) records.push(record('CNAME', fqdn, business, 'origin_cname'))
  for (const dcv of dcvDelegationRecords(hostname)) records.push(record('CNAME', dcv.name, dcv.value, 'dcv_delegation'))
  // 所有权 TXT 只在清理快照中出现
  const ownership = includeAll ? ownershipRecord(hostname) : null
  if (ownership) records.push(record('TXT', ownership.name, ownership.value, 'ownership_verification'))
  return records
}
