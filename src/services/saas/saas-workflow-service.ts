import { ProviderRepository } from '../../repositories/provider-repository.js'
import { ApiError } from '../../support/api-error.js'
import { completed, type DnsSideEffect, type SideEffects } from '../../support/side-effect-result.js'
import { DnsPodSyncSupport, type DnsPodSyncRecord } from '../concerns/dns-pod-sync-support.js'
import { CloudflareDnsRecordService } from '../cloudflare/cloudflare-dns-record-service.js'
import { CloudflareZoneService } from '../cloudflare/cloudflare-zone-service.js'
import { SaasHostnameService } from './saas-hostname-service.js'
import { SaasPreferenceService } from './saas-preference-service.js'

export class SaasWorkflowService {
  constructor(
    private readonly providers: ProviderRepository = new ProviderRepository(),
    private readonly hostnames: SaasHostnameService = new SaasHostnameService(),
    private readonly preferences: SaasPreferenceService = new SaasPreferenceService(),
    private readonly support: DnsPodSyncSupport = new DnsPodSyncSupport(),
    private readonly cloudflareZones: CloudflareZoneService = new CloudflareZoneService(),
    private readonly cloudflareDns: CloudflareDnsRecordService = new CloudflareDnsRecordService()
  ) {}

  async listHostnames(providerId: string, zoneName: string, page: number, perPage: number, refresh = false): Promise<Record<string, unknown>> {
    const result = await this.hostnames.hostnames(providerId, zoneName, page, perPage, refresh)

    if (!refresh) return result

    const cleanup: Record<string, unknown> = {}
    for (const item of (result.items as Array<Record<string, unknown>>) ?? []) {
      const fqdn = String(item.hostname ?? '').trim()
      const hostnameId = String(item.id ?? '').trim()
      const shouldCleanup = await this.shouldCleanupOwnershipTxt(providerId, hostnameId, item)
      delete item.previous_status

      if (shouldCleanup && fqdn !== '') {
        const driver = await this.syncDriverForHostname(providerId, zoneName, fqdn)
        cleanup[fqdn] = await this.rememberOwnershipCleanup(
          providerId,
          hostnameId,
          fqdn,
          await this.safeSync(() => driver.cleanupStaleRecords(providerId, zoneName, fqdn))
        )
      }
    }

    if (Object.keys(cleanup).length > 0) {
      return {
        ...result,
        side_effects: this.dnsSideEffects({ cleanup: completed('列表刷新后已执行 DNS 清理检查', [cleanup]) }),
      }
    }

    return result
  }

  async createHostname(providerId: string, zoneName: string, data: Record<string, unknown>, autoSync = false): Promise<Record<string, unknown>> {
    if (autoSync) {
      await (await this.syncDriverForInput(providerId, data)).preflight(providerId, String(data.hostname ?? ''), data)
    }

    const result = await this.hostnames.createHostname(providerId, zoneName, data)

    if (autoSync && result.hostname) {
      const driver = await this.syncDriverForResult(providerId, zoneName, String(result.hostname))
      const sync = await this.safeSync(() => driver.sync(providerId, zoneName, String(result.hostname)))
      return { ...result, side_effects: this.dnsSideEffects({ sync: this.normalizeSyncOperation(sync, '已执行 DNS 同步') }) }
    }

    return result
  }

  async updateHostname(providerId: string, zoneName: string, hostnameFqdn: string, data: Record<string, unknown>, autoSync = false): Promise<Record<string, unknown>> {
    let beforeRecords: Array<Record<string, unknown>> = []
    if (autoSync) {
      const collected = await (await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)).collectRecordsFor(providerId, zoneName, hostnameFqdn)
      beforeRecords = (collected.records as Array<Record<string, unknown>>) ?? []
    }

    const result = await this.hostnames.updateHostname(providerId, zoneName, hostnameFqdn, data)

    if (autoSync) {
      const driver = await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)
      const sync = await this.safeSync(() => driver.resyncAfterUpdate(providerId, zoneName, hostnameFqdn, beforeRecords))
      return { ...result, side_effects: this.dnsSideEffects({ sync: this.normalizeSyncOperation(sync, '已执行 DNS 重同步') }) }
    }

    return result
  }

  async refreshHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const result = await this.hostnames.refreshHostname(providerId, zoneName, hostnameFqdn)
    const hostnameId = String(result.id ?? '').trim()
    const shouldCleanup = await this.shouldCleanupOwnershipTxt(providerId, hostnameId, result)

    if (shouldCleanup) {
      const driver = await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)
      const cleanup = await this.safeSync(() => driver.cleanupStaleRecords(providerId, zoneName, hostnameFqdn))
      return {
        ...result,
        side_effects: this.dnsSideEffects({ cleanup: this.normalizeCleanupOperation(cleanup, '已执行 DNS 清理') }),
      }
    }

    delete result.previous_status
    return result
  }

  async deleteHostname(providerId: string, zoneName: string, hostnameFqdn: string, autoCleanup = true): Promise<Record<string, unknown>> {
    const driver = await this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)
    const collected = autoCleanup ? await driver.collectRecordsFor(providerId, zoneName, hostnameFqdn) : null
    const result = await this.hostnames.deleteHostname(providerId, zoneName, hostnameFqdn)

    if (collected && (collected.records as Array<Record<string, unknown>>).length > 0 && String(collected.hostname_fqdn ?? '') !== '') {
      const cleanup = await this.safeSync(() => driver.cleanup(providerId, String(collected.hostname_fqdn), collected.records as Array<Record<string, unknown>>))
      return { ...result, side_effects: this.dnsSideEffects({ cleanup: this.normalizeCleanupOperation(cleanup, '已执行 DNS 删除后清理') }) }
    }

    return result
  }

  private async syncDriverForInput(providerId: string, data: Record<string, unknown>): Promise<SyncDriver> {
    let target = String(data.sync_target ?? '').trim()
    if (target === '') target = await this.hostnames.defaultSyncTarget(providerId)
    return target === 'cloudflare_dns' ? this.cloudflareDnsDriver() : this.dnspodDriver()
  }

  private async syncDriverForHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<SyncDriver> {
    const config = await this.hostnames.effectiveSyncConfig(providerId, hostnameFqdn, zoneName)
    const target = String(config.sync_target ?? '').trim()
    return target === 'cloudflare_dns' ? this.cloudflareDnsDriver() : this.dnspodDriver()
  }

  private async syncDriverForResult(providerId: string, zoneName: string, hostnameFqdn: string): Promise<SyncDriver> {
    return this.syncDriverForHostname(providerId, zoneName, hostnameFqdn)
  }

  private dnspodDriver(): SyncDriver {
    return new DnspodSyncDriver(this.hostnames, this.support)
  }

  private cloudflareDnsDriver(): SyncDriver {
    return new CloudflareDnsSyncDriver(this.providers, this.hostnames, this.cloudflareZones, this.cloudflareDns)
  }

  private async shouldCleanupOwnershipTxt(providerId: string, hostnameId: string, hostname: Record<string, unknown>): Promise<boolean> {
    if (!this.isHostnameActive(hostname) || hostnameId === '') return false
    return !(await this.preferences.ownershipTxtCleaned(await this.hostnames.cloudflareProviderIdFor(providerId), hostnameId))
  }

  private async rememberOwnershipCleanup(providerId: string, hostnameId: string, fqdn: string, result: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (hostnameId === '') return result
    const cleaned = String(result.status ?? '') !== 'failed'
    await this.preferences.markOwnershipTxtCleaned(await this.hostnames.cloudflareProviderIdFor(providerId), hostnameId, cleaned, fqdn)
    return result
  }

  private isHostnameActive(hostname: Record<string, unknown>): boolean {
    return ['active', 'active_renewing', 'moved'].includes(String(hostname.status ?? ''))
  }

  private async safeSync<T>(fn: () => Promise<T>): Promise<T | Record<string, unknown>> {
    try {
      return await fn()
    } catch (error) {
      return {
        status: 'skipped',
        code: error instanceof ApiError ? error.code : 'sync_skipped',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private normalizeSyncOperation(result: unknown, defaultMessage: string): DnsSideEffect {
    const r = result as Record<string, unknown>
    let status = String(r.status ?? '')
    if (status === '') status = this.deriveSyncStatus(r)
    return { status: status as DnsSideEffect['status'], message: String(r.message ?? defaultMessage), details: [r] }
  }

  private normalizeCleanupOperation(result: unknown, defaultMessage: string): DnsSideEffect {
    const r = result as Record<string, unknown>
    const cleaned = Number(r.cleaned ?? 0)
    const status = r.status === 'skipped' ? 'skipped' : cleaned > 0 ? 'completed' : 'skipped'
    let message = String(r.message ?? '')
    if (message === '') {
      message = status === 'completed' ? defaultMessage : String(r.reason ?? '') !== '' ? 'DNS 清理已跳过' : '未找到需要清理的 DNS 记录'
    }
    return { status: status as DnsSideEffect['status'], message, details: [r] }
  }

  private deriveSyncStatus(result: Record<string, unknown>): DnsSideEffect['status'] {
    const records = Array.isArray(result.records) ? result.records : []
    if (records.length === 0) {
      return String(result.reason ?? '') !== '' || String(result.code ?? '') !== '' ? 'skipped' : 'completed'
    }
    for (const record of records) {
      if (typeof record === 'object' && record !== null && (record as Record<string, unknown>).status === 'failed') {
        return 'failed'
      }
    }
    return 'completed'
  }

  private dnsSideEffects(effects: { sync?: DnsSideEffect; cleanup?: DnsSideEffect }): SideEffects {
    const sideEffects: SideEffects = { dns: {} }
    if (effects.sync) sideEffects.dns!.sync = effects.sync
    if (effects.cleanup) sideEffects.dns!.cleanup = effects.cleanup
    return sideEffects
  }
}

interface SyncDriver {
  preflight(providerId: string, hostnameFqdn: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>
  sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
  resyncAfterUpdate(providerId: string, cfZoneName: string, hostnameFqdn: string, beforeRecords: Array<Record<string, unknown>>): Promise<Record<string, unknown>>
  cleanup(providerId: string, hostnameFqdn: string, records: Array<Record<string, unknown>>): Promise<Record<string, unknown>>
  cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
  collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>>
}

class DnspodSyncDriver implements SyncDriver {
  private readonly purposeLabels: Record<string, string> = {
    origin_cname: '默认回源',
    ownership_verification: '所有权验证',
    dcv_delegation: 'DCV 委派',
    preferred_cname: '优选域名',
  }
  private readonly preferredLine = '境内'
  private readonly defaultLine = '默认'

  constructor(
    private readonly hostnames: SaasHostnameService,
    private readonly support: DnsPodSyncSupport
  ) {}

  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    let dnspodProviderId = String(data.sync_provider_id ?? '').trim()
    if (dnspodProviderId === '') {
      dnspodProviderId = await this.support.requireDnspodProviderId(providerId, 'saas', 'SaaS')
    }
    const fqdn = hostnameFqdn.trim()
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)

    const dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn, String(data.sync_zone ?? ''))
    return { dnspod_provider_id: dnspodProviderId, dnspod_zone: dnspodZone, hostname_fqdn: fqdn }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = this.requireFqdn(hostname)
    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    const dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(effectiveOrigin)

    const records = this.collectRecords(hostname, effectiveOrigin, dnspodProviderId, dnspodZone)
    if (records.length === 0) {
      throw new ApiError('saas_no_sync_records', 'No records available for sync', 422)
    }

    const precleaned = await this.support.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
    const results = await Promise.all(records.map((record) => this.withPurpose(record, this.support.sync(dnspodProviderId, dnspodZone, record))))

    return { hostname_fqdn: fqdn, hostname: fqdn, dnspod_zone: dnspodZone, precleaned, records: results }
  }

  async resyncAfterUpdate(providerId: string, cfZoneName: string, hostnameFqdn: string, beforeRecords: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = this.requireFqdn(hostname)
    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    if (dnspodProviderId === '') return { cleaned: 0, records: [], deleted: [], reason: 'dnspod_provider_missing' }

    let dnspodZone = ''
    try {
      dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
    } catch {
      return { cleaned: 0, records: [], deleted: [], reason: 'dnspod_zone_not_found' }
    }

    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(effectiveOrigin)
    const afterRecords = this.collectRecords(hostname, effectiveOrigin, dnspodProviderId, dnspodZone)
    const deleted = await this.deleteMissingRecords(dnspodProviderId, dnspodZone, beforeRecords, afterRecords)
    const precleaned = afterRecords.length === 0 ? [] : await this.support.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
    const results = await Promise.all(afterRecords.map((record) => this.withPurpose(record, this.support.sync(dnspodProviderId, dnspodZone, record))))

    return {
      hostname: fqdn,
      dnspod_zone: dnspodZone,
      cleaned: deleted.filter((r) => r.status === 'deleted').length,
      deleted,
      precleaned,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
    if (records.length === 0 || hostnameFqdn === '') return { cleaned: 0, records: [] }

    const dnspodProviderId = String(records[0]?.provider_id ?? '').trim()
    if (dnspodProviderId === '') return { cleaned: 0, records: [] }

    let dnspodZone = String(records[0]?.dnspod_zone ?? '').trim()
    if (dnspodZone === '') {
      try {
        dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, hostnameFqdn)
      } catch {
        return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
      }
    }

    const results = await Promise.all(records.map((record) => this.withPurpose(record as DnsPodSyncRecord, this.support.delete(dnspodProviderId, dnspodZone, record as DnsPodSyncRecord))))
    return { cleaned: results.filter((r) => r.status === 'deleted').length, dnspod_zone: dnspodZone, records: results }
  }

  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!this.isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }

    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') return { cleaned: 0, reason: 'fqdn_missing' }

    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    if (dnspodProviderId === '') return { cleaned: 0, reason: 'dnspod_provider_missing' }

    let dnspodZone = ''
    try {
      dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
    } catch {
      return { cleaned: 0, reason: 'dnspod_zone_not_found' }
    }

    const ownershipFqdn = `_cf-custom-hostname.${fqdn}`
    const deleted = await this.support.deleteRecordsByNameType(dnspodProviderId, dnspodZone, ownershipFqdn, 'TXT', this.defaultLine)
    return { cleaned: deleted.filter((r) => r.status === 'deleted').length, dnspod_zone: dnspodZone, records: deleted }
  }

  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const dnspodProviderId = await this.resolveDnspodProviderId(providerId, hostname)
    const fqdn = String(hostname.hostname ?? '')

    let dnspodZone = ''
    if (fqdn !== '' && dnspodProviderId !== '') {
      try {
        dnspodZone = await this.resolveTargetZone(providerId, dnspodProviderId, fqdn)
      } catch {
        dnspodZone = ''
      }
    }

    return {
      hostname_fqdn: fqdn,
      records: this.collectRecords(hostname, await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname), dnspodProviderId, dnspodZone, true, true),
    }
  }

  private requireFqdn(hostname: Record<string, unknown>): string {
    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)
    return fqdn
  }

  private async resolveEffectiveOrigin(providerId: string, cfZoneName: string, hostname: Record<string, unknown>): Promise<string> {
    const custom = String(hostname.custom_origin_server ?? '').trim()
    if (custom !== '') return custom
    return (await this.hostnames.fallbackOrigin(providerId, cfZoneName)) ?? ''
  }

  private requireBusinessTarget(effectiveOrigin: string): void {
    if (effectiveOrigin.trim() === '') {
      throw new ApiError('saas_business_target_missing', 'No business CNAME target available', 422)
    }
  }

  private async resolveTargetZone(providerId: string, dnspodProviderId: string, fqdn: string, explicitSyncZone = ''): Promise<string> {
    if (explicitSyncZone !== '') {
      return this.support.requireExplicitDnspodZone(dnspodProviderId, explicitSyncZone, 'saas')
    }

    const sync = await this.hostnames.syncConfig(providerId, fqdn, '')
    const syncZone = String(sync.sync_zone ?? '').trim()
    if (syncZone !== '') {
      return this.support.requireExplicitDnspodZone(dnspodProviderId, syncZone, 'saas')
    }

    return this.support.resolveDnspodZone(dnspodProviderId, fqdn, 'saas')
  }

  private async resolveDnspodProviderId(providerId: string, hostname: Record<string, unknown>): Promise<string> {
    const syncProviderId = String(hostname.sync_provider_id ?? '').trim()
    if (syncProviderId !== '') return syncProviderId
    return this.support.lookupDnspodProviderId(providerId, 'saas', 'SaaS')
  }

  private collectRecords(
    hostname: Record<string, unknown>,
    effectiveOrigin: string,
    dnspodProviderId: string,
    dnspodZone: string,
    includeAll = false,
    forceOwnershipName = false
  ): DnsPodSyncRecord[] {
    const records: DnsPodSyncRecord[] = []
    const fqdn = String(hostname.hostname ?? '')
    const shouldOutputOwnership = includeAll || !this.isHostnameActive(hostname)
    const autoPreferred = Boolean(hostname.auto_preferred ?? false)

    if (fqdn !== '' && effectiveOrigin !== '') {
      records.push(this.record('CNAME', fqdn, effectiveOrigin, 'origin_cname', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
    }

    const metadata = (hostname.custom_metadata as Record<string, unknown> | null) ?? {}
    const preferred = String(metadata.preferred_domain ?? '').trim()
    if (autoPreferred && fqdn !== '' && preferred !== '') {
      records.push(this.record('CNAME', fqdn, preferred, 'preferred_cname', fqdn, dnspodProviderId, this.preferredLine, dnspodZone))
    }

    const ssl = (hostname.ssl as Record<string, unknown>) ?? {}
    const dcvRecords = Array.isArray(ssl.dcv_delegation_records) ? ssl.dcv_delegation_records : []
    let dcvAdded = false
    for (const rec of dcvRecords) {
      if (typeof rec !== 'object' || rec === null) continue
      const cname = String((rec as Record<string, unknown>).cname ?? '')
      const target = String((rec as Record<string, unknown>).cname_target ?? '')
      if (cname !== '' && target !== '') {
        records.push(this.record('CNAME', cname, target, 'dcv_delegation', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
        dcvAdded = true
      }
    }

    if (!dcvAdded && fqdn !== '') {
      const uuid = String(ssl.dcv_delegation_uuid ?? '').trim()
      if (uuid !== '') {
        records.push(this.record('CNAME', `_acme-challenge.${fqdn}`, `${fqdn}.${uuid}.dcv.cloudflare.com`, 'dcv_delegation', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
      }
    }

    if (shouldOutputOwnership) {
      const ownership = (hostname.ownership_verification as Record<string, unknown>) ?? null
      if (ownership && ownership.name && ownership.value) {
        records.push(this.record('TXT', String(ownership.name), String(ownership.value), 'ownership_verification', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
      } else if (forceOwnershipName && fqdn !== '') {
        records.push(this.record('TXT', `_cf-custom-hostname.${fqdn}`, '', 'ownership_verification', fqdn, dnspodProviderId, this.defaultLine, dnspodZone))
      }
    }

    return records
  }

  private isHostnameActive(hostname: Record<string, unknown>): boolean {
    return ['active', 'active_renewing', 'moved'].includes(String(hostname.status ?? ''))
  }

  private record(
    type: string,
    name: string,
    value: string,
    purpose: string,
    fqdn: string,
    dnspodProviderId: string,
    line: string,
    dnspodZone: string
  ): DnsPodSyncRecord {
    return {
      type,
      name,
      value,
      line,
      purpose,
      provider_id: dnspodProviderId,
      dnspod_zone: dnspodZone,
      remark: `${this.purposeLabels[purpose] ?? '自定义主机名'}丨${fqdn}`,
    }
  }

  private async withPurpose(record: DnsPodSyncRecord, resultPromise: Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const result = await resultPromise
    return { purpose: record.purpose, ...result }
  }

  private async deleteMissingRecords(dnspodProviderId: string, dnspodZone: string, beforeRecords: Array<Record<string, unknown>>, afterRecords: DnsPodSyncRecord[]): Promise<Array<Record<string, unknown>>> {
    const afterMap = new Set(afterRecords.map((record) => this.recordSignature(record)))
    const deleted: Array<Record<string, unknown>> = []
    const seen = new Set<string>()

    for (const record of beforeRecords) {
      const signature = this.recordSignature(record)
      if (signature === '' || seen.has(signature) || afterMap.has(signature)) continue
      seen.add(signature)
      deleted.push(await this.withPurpose(record as DnsPodSyncRecord, this.support.delete(dnspodProviderId, dnspodZone, record as DnsPodSyncRecord)))
    }

    return deleted
  }

  private recordSignature(record: Record<string, unknown>): string {
    const type = String(record.type ?? '').toUpperCase().trim()
    const name = String(record.name ?? '').toLowerCase().replace(/\.$/, '').trim()
    const value = String(record.value ?? '').toLowerCase().replace(/\.$/, '').trim()
    const line = String(record.line ?? this.defaultLine).trim()
    if (type === '' || name === '' || value === '') return ''
    return [type, name, value, line].join('|')
  }
}

class CloudflareDnsSyncDriver implements SyncDriver {
  private readonly purposeLabels: Record<string, string> = {
    origin_cname: '业务接入',
    ownership_verification: '所有权验证',
    dcv_delegation: 'DCV 委派',
  }

  constructor(
    private readonly providers: ProviderRepository,
    private readonly hostnames: SaasHostnameService,
    private readonly zones: CloudflareZoneService,
    private readonly records: CloudflareDnsRecordService
  ) {}

  async preflight(providerId: string, hostnameFqdn: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, hostnameFqdn, String(data.sync_zone ?? ''))
    return { cloudflare_provider_id: cloudflareProviderId, cloudflare_zone_id: zoneId, cloudflare_zone: zoneName, hostname_fqdn: hostnameFqdn.trim() }
  }

  async sync(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, hostnameFqdn)
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const fqdn = this.requireFqdn(hostname)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(hostname, effectiveOrigin)

    const records = this.collectRecords(hostname, effectiveOrigin, zoneName, cloudflareProviderId)
    if (records.length === 0) throw new ApiError('saas_no_sync_records', 'No records available for sync', 422)

    const results = await Promise.all(records.map((record) => this.withPurpose(record, this.syncRecord(cloudflareProviderId, zoneId, record))))
    return { hostname_fqdn: fqdn, hostname: fqdn, cloudflare_provider_id: cloudflareProviderId, cloudflare_zone: zoneName, records: results }
  }

  async resyncAfterUpdate(providerId: string, cfZoneName: string, hostnameFqdn: string, beforeRecords: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    const fqdn = this.requireFqdn(hostname)
    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, fqdn)
    const effectiveOrigin = await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname)
    this.requireBusinessTarget(hostname, effectiveOrigin)

    const afterRecords = this.collectRecords(hostname, effectiveOrigin, zoneName, cloudflareProviderId)
    const deleted = await this.deleteMissingRecords(cloudflareProviderId, zoneId, beforeRecords, afterRecords)
    const results = await Promise.all(afterRecords.map((record) => this.withPurpose(record, this.syncRecord(cloudflareProviderId, zoneId, record))))

    return {
      hostname_fqdn: fqdn,
      cloudflare_zone: zoneName,
      cleaned: deleted.filter((r) => r.status === 'deleted').length,
      deleted,
      records: results,
    }
  }

  async cleanup(providerId: string, hostnameFqdn: string, records: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
    if (records.length === 0 || hostnameFqdn === '') return { cleaned: 0, records: [] }

    let cloudflareProviderId = String(records[0]?.provider_id ?? '').trim()
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)
    const zoneName = String(records[0]?.zone_name ?? '').trim()
    if (zoneName === '') return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }

    let zoneId = ''
    try {
      zoneId = await this.zones.idByName(cloudflareProviderId, zoneName)
    } catch {
      return { cleaned: 0, records: [], reason: 'cloudflare_zone_not_found' }
    }

    const results = await Promise.all(records.map((record) => this.withPurpose(record as never, this.deleteRecord(cloudflareProviderId, zoneId, record))))
    return { cleaned: results.filter((r) => r.status === 'deleted').length, cloudflare_zone: zoneName, records: results }
  }

  async cleanupStaleRecords(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn, true)
    if (!this.isHostnameActive(hostname)) return { cleaned: 0, reason: 'saas_not_active' }

    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') return { cleaned: 0, reason: 'fqdn_missing' }

    const [cloudflareProviderId, zoneId, zoneName] = await this.resolveTarget(providerId, fqdn)
    const ownership = (hostname.ownership_verification as Record<string, unknown>) ?? {}
    const record = this.record('TXT', `_cf-custom-hostname.${fqdn}`, String(ownership.value ?? ''), 'ownership_verification', fqdn, zoneName, cloudflareProviderId)
    const result = await this.deleteRecord(cloudflareProviderId, zoneId, record)

    return { cleaned: result.status === 'deleted' ? 1 : 0, cloudflare_zone: zoneName, records: [result] }
  }

  async collectRecordsFor(providerId: string, cfZoneName: string, hostnameFqdn: string): Promise<Record<string, unknown>> {
    const hostname = await this.hostnames.showHostname(providerId, cfZoneName, hostnameFqdn)
    const sync = await this.hostnames.syncConfig(providerId, String(hostname.hostname ?? ''), cfZoneName)
    let cloudflareProviderId = String(sync.sync_provider_id ?? '').trim()
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)
    const zoneName = String(sync.sync_zone ?? '').trim()

    return {
      hostname_fqdn: String(hostname.hostname ?? ''),
      records: this.collectRecords(hostname, await this.resolveEffectiveOrigin(providerId, cfZoneName, hostname), zoneName, cloudflareProviderId, true),
    }
  }

  private async resolveTarget(providerId: string, hostnameFqdn: string, explicitSyncZone = '', explicitSyncProviderId = ''): Promise<[string, string, string]> {
    let cloudflareProviderId = explicitSyncProviderId.trim()
    if (cloudflareProviderId === '') {
      const sync = await this.hostnames.syncConfig(providerId, hostnameFqdn)
      cloudflareProviderId = String(sync.sync_provider_id ?? '').trim()
    }
    if (cloudflareProviderId === '') cloudflareProviderId = await this.requireCloudflareDnsProviderId(providerId)

    let zoneName = explicitSyncZone.toLowerCase().trim()
    if (zoneName === '') {
      const sync = await this.hostnames.syncConfig(providerId, hostnameFqdn)
      zoneName = String(sync.sync_zone ?? '').toLowerCase().trim()
    }
    if (zoneName === '') throw new ApiError('saas_cloudflare_sync_zone_missing', 'Cloudflare DNS sync zone is required', 422)

    const zoneId = await this.zones.idByName(cloudflareProviderId, zoneName)
    return [cloudflareProviderId, zoneId, zoneName]
  }

  private async requireCloudflareDnsProviderId(providerId: string): Promise<string> {
    const provider = await this.providers.requireType(providerId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')
    const record = provider as unknown as Record<string, unknown>
    const id = String(record.cloudflare_dns_provider ?? '')
    if (id !== '') return id
    const fallback = String(record.cloudflare_provider ?? '')
    if (fallback !== '') return fallback
    throw new ApiError('saas_cloudflare_dns_provider_missing', 'SaaS provider is not linked to a Cloudflare DNS provider', 422)
  }

  private requireFqdn(hostname: Record<string, unknown>): string {
    const fqdn = String(hostname.hostname ?? '')
    if (fqdn === '') throw new ApiError('saas_fqdn_missing', 'SaaS hostname FQDN missing', 422)
    return fqdn
  }

  private async resolveEffectiveOrigin(providerId: string, cfZoneName: string, hostname: Record<string, unknown>): Promise<string> {
    const custom = String(hostname.custom_origin_server ?? '').trim()
    if (custom !== '') return custom
    return (await this.hostnames.fallbackOrigin(providerId, cfZoneName)) ?? ''
  }

  private requireBusinessTarget(hostname: Record<string, unknown>, effectiveOrigin: string): void {
    const autoPreferred = Boolean(hostname.auto_preferred ?? false)
    const metadata = (hostname.custom_metadata as Record<string, unknown> | null) ?? {}
    const preferred = String(metadata.preferred_domain ?? '').trim()
    const businessTarget = autoPreferred && preferred !== '' ? preferred : effectiveOrigin
    if (businessTarget === '') throw new ApiError('saas_business_target_missing', 'No business CNAME target available', 422)
  }

  private collectRecords(hostname: Record<string, unknown>, effectiveOrigin: string, zoneName: string, cloudflareProviderId: string, includeAll = false): Array<Record<string, unknown>> {
    const records: Array<Record<string, unknown>> = []
    const fqdn = String(hostname.hostname ?? '')
    const shouldOutputOwnership = includeAll || !this.isHostnameActive(hostname)
    const autoPreferred = Boolean(hostname.auto_preferred ?? false)
    const metadata = (hostname.custom_metadata as Record<string, unknown> | null) ?? {}
    const preferred = String(metadata.preferred_domain ?? '').trim()
    const businessTarget = autoPreferred && preferred !== '' ? preferred : effectiveOrigin

    if (fqdn !== '' && businessTarget !== '') {
      records.push(this.record('CNAME', fqdn, businessTarget, 'origin_cname', fqdn, zoneName, cloudflareProviderId))
    }

    const ssl = (hostname.ssl as Record<string, unknown>) ?? {}
    const dcvRecords = Array.isArray(ssl.dcv_delegation_records) ? ssl.dcv_delegation_records : []
    let dcvAdded = false
    for (const rec of dcvRecords) {
      if (typeof rec !== 'object' || rec === null) continue
      const cname = String((rec as Record<string, unknown>).cname ?? '')
      const target = String((rec as Record<string, unknown>).cname_target ?? '')
      if (cname !== '' && target !== '') {
        records.push(this.record('CNAME', cname, target, 'dcv_delegation', fqdn, zoneName, cloudflareProviderId))
        dcvAdded = true
      }
    }

    if (!dcvAdded && fqdn !== '') {
      const uuid = String(ssl.dcv_delegation_uuid ?? '').trim()
      if (uuid !== '') {
        records.push(this.record('CNAME', `_acme-challenge.${fqdn}`, `${fqdn}.${uuid}.dcv.cloudflare.com`, 'dcv_delegation', fqdn, zoneName, cloudflareProviderId))
      }
    }

    if (shouldOutputOwnership) {
      const ownership = (hostname.ownership_verification as Record<string, unknown>) ?? null
      if (ownership && ownership.name && ownership.value) {
        records.push(this.record('TXT', String(ownership.name), String(ownership.value), 'ownership_verification', fqdn, zoneName, cloudflareProviderId))
      }
    }

    return records
  }

  private isHostnameActive(hostname: Record<string, unknown>): boolean {
    return ['active', 'active_renewing', 'moved'].includes(String(hostname.status ?? ''))
  }

  private record(type: string, name: string, value: string, purpose: string, fqdn: string, zoneName: string, cloudflareProviderId: string): Record<string, unknown> {
    return {
      type,
      name,
      value,
      purpose,
      provider_id: cloudflareProviderId,
      zone_name: zoneName,
      comment: `${this.purposeLabels[purpose] ?? '自定义主机名'}丨${fqdn}`,
    }
  }

  private async withPurpose(record: Record<string, unknown>, resultPromise: Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const result = await resultPromise
    return { purpose: record.purpose, ...result }
  }

  private async syncRecord(cloudflareProviderId: string, zoneId: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name, value: record.value }
    const matches = await this.exactMatches(cloudflareProviderId, zoneId, String(record.name), String(record.type))
    const expectedValue = String(record.value ?? '').replace(/\.$/, '')
    const expectedComment = String(record.comment ?? '')

    for (const match of matches) {
      const value = String(match.content ?? '').replace(/\.$/, '')
      if (value === expectedValue) {
        const comment = String(match.comment ?? '')
        if (comment === expectedComment || comment === '') {
          return { ...base, status: 'unchanged', record_id: String(match.id ?? '') }
        }
      }
    }

    for (const match of matches) {
      if (String(match.comment ?? '') !== expectedComment) continue
      const updated = await this.records.update(cloudflareProviderId, zoneId, String(match.id), this.recordPayload(record) as never)
      return { ...base, status: 'updated', record_id: String(updated.id ?? match.id ?? '') }
    }

    if (matches.length > 0) {
      throw new ApiError('cloudflare_dns_record_conflict', 'Cloudflare DNS record conflict', 409, { name: record.name, type: record.type })
    }

    const created = await this.records.create(cloudflareProviderId, zoneId, this.recordPayload(record) as never)
    return { ...base, status: 'created', record_id: String(created.id ?? '') }
  }

  private async deleteRecord(cloudflareProviderId: string, zoneId: string, record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const base = { type: record.type, name: record.name }
    const expectedValue = String(record.value ?? '').replace(/\.$/, '')
    const expectedComment = String(record.comment ?? '')

    for (const match of await this.exactMatches(cloudflareProviderId, zoneId, String(record.name), String(record.type))) {
      const value = String(match.content ?? '').replace(/\.$/, '')
      if (value !== expectedValue) continue
      const comment = String(match.comment ?? '')
      if (comment !== '' && comment !== expectedComment) continue
      const recordId = String(match.id ?? '')
      if (recordId === '') continue
      await this.records.delete(cloudflareProviderId, zoneId, recordId)
      return { ...base, status: 'deleted', record_id: recordId }
    }

    return { ...base, status: 'not_found', record_id: '' }
  }

  private async exactMatches(cloudflareProviderId: string, zoneId: string, fqdn: string, type: string): Promise<Array<Record<string, unknown>>> {
    const matches: Array<Record<string, unknown>> = []
    let page = 1
    let totalPages = 1

    do {
      const result = await this.records.list(cloudflareProviderId, zoneId, { type, search: fqdn, page, per_page: 100 })
      for (const record of result.items) {
        if (String(record.name ?? '') === fqdn && String(record.type ?? '') === type) {
          matches.push(record as unknown as Record<string, unknown>)
        }
      }
      totalPages = Number(result.pagination.total_pages ?? result.pagination.total_count ?? 1)
      page++
    } while (page <= totalPages)

    return matches
  }

  private recordPayload(record: Record<string, unknown>): Record<string, unknown> {
    return {
      type: String(record.type),
      name: String(record.name),
      content: String(record.value),
      ttl: 1,
      comment: String(record.comment ?? ''),
      proxied: false,
    }
  }

  private async deleteMissingRecords(cloudflareProviderId: string, zoneId: string, beforeRecords: Array<Record<string, unknown>>, afterRecords: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
    const afterMap = new Set(afterRecords.map((record) => this.recordSignature(record)))
    const deleted: Array<Record<string, unknown>> = []
    const seen = new Set<string>()

    for (const record of beforeRecords) {
      const signature = this.recordSignature(record)
      if (signature === '' || seen.has(signature) || afterMap.has(signature)) continue
      seen.add(signature)
      deleted.push(await this.withPurpose(record as never, this.deleteRecord(cloudflareProviderId, zoneId, record)))
    }

    return deleted
  }

  private recordSignature(record: Record<string, unknown>): string {
    const type = String(record.type ?? '').toUpperCase().trim()
    const name = String(record.name ?? '').toLowerCase().replace(/\.$/, '').trim()
    const value = String(record.value ?? '').toLowerCase().replace(/\.$/, '').trim()
    if (type === '' || name === '' || value === '') return ''
    return [type, name, value].join('|')
  }
}
