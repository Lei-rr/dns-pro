import { ApiError } from '../../kernel/http/api-error.js'
import { errorMessage, normalizeFqdn } from '../../lib/values.js'
import type {
  CloudflareDnsRecordService,
  RecordPayload,
} from '../../domains/cloudflare/cloudflare-dns-record.service.js'
import type { CloudflareZoneService } from '../../domains/cloudflare/cloudflare-zone.service.js'
import type { CloudflareCustomHostname } from '../../domains/cloudflare/saas/saas-custom-hostname.client.js'
import { isHostnameActive, zoneOwnsHostname } from '../../domains/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../domains/cloudflare/saas/saas-hostname.service.js'
import type { SaaSSyncConfigService } from '../../domains/cloudflare/saas/saas-sync-config.service.js'
import {
  CLOUDFLARE_ORIGIN_LABEL,
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

const stripDot = (value: unknown) => String(value ?? '').replace(/\.$/, '')

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
    private readonly records: CloudflareDnsRecordService
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
    const results = await this.syncAll(target, records)
    return {
      hostname_fqdn: fqdn,
      hostname: fqdn,
      cloudflare_provider_id: target.cloudflareProviderId,
      cloudflare_zone: target.zoneName,
      records: results,
    }
  }

  async resyncAfterUpdate(providerId: string, cfZoneName: string, hostnameFqdn: string, beforeRecords: SyncRecord[]) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = requireFqdn(hostname)
    const target = await this.resolveTarget(providerId, fqdn)
    const afterRecords = buildRecords(
      hostname,
      await this.businessTarget(providerId, cfZoneName, hostname, true),
      target
    )
    const deleted = await deleteRemovedSyncRecords(
      beforeRecords,
      afterRecords,
      (record) => syncRecordIdentity(record),
      (record) => this.deleteRecord(target, record)
    )
    const results = await this.syncAll(target, afterRecords)
    return {
      hostname_fqdn: fqdn,
      cloudflare_zone: target.zoneName,
      cleaned: countDeleted(deleted),
      deleted,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: SyncRecord[]) {
    if (records.length === 0 || hostnameFqdn === '') return { cleaned: 0, records: [] }
    const zoneName = String(records[0]?.zone_name ?? '').trim()
    if (zoneName === '') return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }
    const cloudflareProviderId =
      String(records[0]?.provider_id ?? '').trim() || (await this.defaultDnsProviderId(providerId))

    let zoneId: string
    try {
      zoneId = await this.zones.idByName(cloudflareProviderId, zoneName)
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'cloudflare_zone_not_found')) throw error
      return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }
    }
    const target = { cloudflareProviderId, zoneId, zoneName }
    const results = await Promise.all(
      records.map((record) => withSyncPurpose(record, this.deleteRecord(target, record)))
    )
    return { cleaned: countDeleted(results), cloudflare_zone: zoneName, records: results }
  }

  /** 主机名激活后删除所有权验证 TXT */
  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string) {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }
    const fqdn = hostname.hostname
    if (!fqdn) return { cleaned: 0, reason: 'fqdn_missing' }

    const target = await this.resolveTarget(providerId, fqdn, { cfZoneName })
    const record = {
      type: 'TXT',
      name: ownershipTxtName(fqdn),
      value: String(hostname.ownership_verification?.value ?? ''),
      purpose: 'ownership_verification',
      provider_id: target.cloudflareProviderId,
      zone_name: target.zoneName,
      comment: syncRemark('ownership_verification', fqdn, CLOUDFLARE_ORIGIN_LABEL),
    }
    const result = await this.deleteRecord(target, record)
    return { cleaned: result.status === 'deleted' ? 1 : 0, cloudflare_zone: target.zoneName, records: [result] }
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

  private syncAll(target: Target, records: SyncRecord[]) {
    return Promise.all(records.map((record) => withSyncPurpose(record, this.syncRecord(target, record))))
  }

  /** 幂等写入：同值视为不变；同名同类型存在则原地更新，否则创建 */
  private async syncRecord(target: Target, record: SyncRecord): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name, value: record.value }
    try {
      const { cloudflareProviderId: cfId, zoneId } = target
      const matches = await this.records.findExact(cfId, zoneId, record.name, record.type)
      const expectedComment = String(record.comment ?? '')
      const unchanged = matches.find(
        (match) =>
          stripDot(match.content) === stripDot(record.value) && (match.comment === expectedComment || !match.comment)
      )
      if (unchanged) return { ...base, status: 'unchanged', record_id: unchanged.id ?? '' }

      const existing = matches.find((match) => match.id)
      if (existing?.id) {
        const updated = await this.records.update(cfId, zoneId, existing.id, recordPayload(record))
        return { ...base, status: 'updated', record_id: updated.id ?? existing.id }
      }
      const created = await this.records.create(cfId, zoneId, recordPayload(record))
      return { ...base, status: 'created', record_id: created.id ?? '' }
    } catch (error) {
      return { ...base, status: 'failed', record_id: '', error: errorMessage(error) }
    }
  }

  /** 删除匹配记录；不删除他人手工写入（带其他备注）的同名记录 */
  private async deleteRecord(target: Target, record: SyncRecord): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name }
    const expectedValue = stripDot(record.value)
    const expectedComment = String(record.comment ?? '')
    const { cloudflareProviderId: cfId, zoneId } = target
    const match = (await this.records.findExact(cfId, zoneId, record.name, record.type)).find(
      (candidate) =>
        candidate.id &&
        (expectedValue === '' || stripDot(candidate.content) === expectedValue) &&
        (!candidate.comment || candidate.comment === expectedComment)
    )
    if (!match?.id) return { ...base, status: 'not_found', record_id: '' }
    await this.records.delete(cfId, zoneId, match.id)
    return { ...base, status: 'deleted', record_id: match.id }
  }
}

function buildRecords(hostname: CloudflareCustomHostname, business: string, target: Target, includeAll = false) {
  const fqdn = hostname.hostname
  if (!fqdn) return []
  const record = (type: string, name: string, value: string, purpose: string): SyncRecord => ({
    type,
    name,
    value,
    purpose,
    provider_id: target.cloudflareProviderId,
    zone_name: target.zoneName,
    comment: syncRemark(purpose, fqdn, CLOUDFLARE_ORIGIN_LABEL),
  })

  const records: SyncRecord[] = []
  if (business) records.push(record('CNAME', fqdn, business, 'origin_cname'))
  for (const dcv of dcvDelegationRecords(hostname)) records.push(record('CNAME', dcv.name, dcv.value, 'dcv_delegation'))
  // 所有权 TXT 只在清理快照中出现
  const ownership = includeAll ? ownershipRecord(hostname) : null
  if (ownership) records.push(record('TXT', ownership.name, ownership.value, 'ownership_verification'))
  return records
}

function recordPayload(record: SyncRecord): RecordPayload {
  return {
    type: record.type,
    name: record.name,
    content: record.value,
    ttl: 1,
    comment: String(record.comment ?? ''),
    proxied: false,
  }
}
