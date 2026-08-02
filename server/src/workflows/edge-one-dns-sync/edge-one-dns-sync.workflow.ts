import { ApiError } from '../../shared/http/api-error.js'
import { wrapProviderError } from '../../shared/http/wrap-provider-error.js'
import { buildDnsSideEffects, type DnsSideEffect } from '../../shared/providers/side-effect-result.js'
import { providerOptionalString } from '../../shared/providers/provider-values.js'
import { DnsPodRecordOps } from '../../modules/dns-pod/dns-pod-record-sync.service.js'
import { EdgeOneGateway } from '../../modules/edge-one/edge-one.client.js'
import { resolveEdgeOneApiCredentials } from '../../modules/edge-one/edge-one-credentials.js'
import { EdgeOneDomainService } from '../../modules/edge-one/edge-one-domain.service.js'
import {
  buildEdgeOneOriginInfo,
  normalizeAccelerationDomainPayload,
  type AccelerationDomainPayload,
} from '../../modules/edge-one/edge-one-domain-payload.js'
import { invalidateEdgeOneDomainCache } from '../../modules/edge-one/edge-one.cache.js'
import {
  edgeoneAccelerationDomainCreateResponseSchema,
  edgeoneMutationResponseSchema,
} from '../../modules/edge-one/edge-one-response.schema.js'
import { ProviderRepository } from '../../modules/providers/provider.repository.js'
import { isExplicitNotFound } from '../../shared/providers/provider-error.js'

/**
 * EdgeOne acceleration-domain lifecycle and its DNSPod side effects.
 *
 * List/update/status/certificate operations remain in the EdgeOne module. Create,
 * delete, explicit CNAME sync, and DNS cleanup are coordinated here so the
 * EdgeOne module never depends on the shared SaaS sync implementation.
 */
export class EdgeOneDnsSyncWorkflow {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly domains: EdgeOneDomainService,
    private readonly dns: DnsPodRecordOps
  ) {}

  async createAccelerationDomain(
    providerId: string,
    zoneId: string,
    data: Record<string, unknown>,
    autoSync = false
  ): Promise<Record<string, unknown>> {
    const normalized = this.normalizeDomainData(data)
    if (autoSync) await this.preflight(providerId, normalized.domain_name)

    const result = await this.createDomain(providerId, zoneId, normalized)
    if (!autoSync || !result.name) return result

    const cname = await this.assignedCname(providerId, zoneId, String(result.name))
    const sync = await this.syncCnameRecord(providerId, String(result.name), cname)
    return {
      ...result,
      side_effects: buildDnsSideEffects({
        sync: this.normalizeSyncSideEffect(sync, '已执行 DNSPod CNAME 同步'),
      }),
    }
  }

  async deleteAccelerationDomain(
    providerId: string,
    zoneId: string,
    domainName: string,
    autoCleanup = false,
    options: { primaryDeleted?: boolean; onPrimaryDeleted?: () => Promise<void> } = {}
  ): Promise<Record<string, unknown>> {
    let cname = ''
    if (autoCleanup && !options.primaryDeleted) {
      try {
        cname = await this.assignedCname(providerId, zoneId, domainName)
      } catch {
        cname = ''
      }
    }

    let primaryResult: Record<string, unknown> = { name: domainName }
    let primaryAlreadyMissing = false
    if (!options.primaryDeleted) {
      try {
        primaryResult = await this.deleteDomain(providerId, zoneId, domainName)
      } catch (error) {
        if (!this.isExplicitProviderNotFound(error)) throw error
        primaryAlreadyMissing = true
        invalidateEdgeOneDomainCache(providerId, zoneId)
      }
    }
    await options.onPrimaryDeleted?.()
    const result = { ...primaryResult, primary_deleted: true, primary_already_missing: primaryAlreadyMissing }
    if (!autoCleanup) return result

    const cleanup = await this.cleanupCnameRecord(providerId, domainName, cname)
    return {
      ...result,
      side_effects: buildDnsSideEffects({
        cleanup: this.normalizeCleanupSideEffect(cleanup, '已执行 DNS 清理'),
      }),
    }
  }

  async repairDomainDns(providerId: string, zoneId: string, domainName: string): Promise<Record<string, unknown>> {
    const cname = await this.assignedCname(providerId, zoneId, domainName, true)
    if (cname === '') {
      throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME not available yet', 422)
    }

    const sync = await this.syncCnameRecord(providerId, domainName, cname)
    const side = this.normalizeSyncSideEffect(sync, '已修复域名解析')
    return { ...sync, side_effects: buildDnsSideEffects({ sync: side }) }
  }

  private async createDomain(
    providerId: string,
    zoneId: string,
    data: AccelerationDomainPayload
  ): Promise<Record<string, unknown>> {
    const provider = await resolveEdgeOneApiCredentials(this.providers, providerId)
    const gateway = EdgeOneGateway.forCredentials({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response
    try {
      response = await gateway.call('CreateAccelerationDomain', {
        ZoneId: zoneId,
        DomainName: data.domain_name,
        OriginInfo: this.buildOriginInfo(data),
        OriginProtocol: data.origin_protocol,
        IPv6Status: data.ipv6_status,
        ...(data.origin_protocol === 'FOLLOW' || data.origin_protocol === 'HTTP'
          ? { HttpOriginPort: data.http_origin_port }
          : {}),
        ...(data.origin_protocol === 'FOLLOW' || data.origin_protocol === 'HTTPS'
          ? { HttpsOriginPort: data.https_origin_port }
          : {}),
      })
    } catch (error) {
      throw wrapProviderError(
        'edgeone_domain_create_failed',
        'EdgeOne acceleration domain create failed',
        providerId,
        error,
        { zone: zoneId, domain: data.domain_name }
      )
    }

    const parsed = edgeoneAccelerationDomainCreateResponseSchema.parse(response)
    const result = {
      name: data.domain_name,
      request_id: providerOptionalString(parsed.RequestId),
      ownership_verification: parsed.OwnershipVerification ?? null,
    }
    invalidateEdgeOneDomainCache(providerId, zoneId)
    return result
  }

  private async deleteDomain(providerId: string, zoneId: string, domainName: string): Promise<Record<string, unknown>> {
    const provider = await resolveEdgeOneApiCredentials(this.providers, providerId)
    const gateway = EdgeOneGateway.forCredentials({ secretId: provider.secret_id, secretKey: provider.secret_key })

    let response
    try {
      response = await gateway.call('DeleteAccelerationDomains', {
        ZoneId: zoneId,
        DomainNames: [domainName],
        Force: false,
      })
    } catch (error) {
      throw wrapProviderError(
        'edgeone_domain_delete_failed',
        'EdgeOne acceleration domain delete failed',
        providerId,
        error,
        { zone: zoneId, domain: domainName }
      )
    }

    const parsed = edgeoneMutationResponseSchema.parse(response)
    const result = { name: domainName, request_id: providerOptionalString(parsed.RequestId) }
    invalidateEdgeOneDomainCache(providerId, zoneId)
    return result
  }

  private async assignedCname(
    providerId: string,
    zoneId: string,
    domainName: string,
    refresh = false
  ): Promise<string> {
    const listing = await this.domains.accelerationDomains(providerId, zoneId, refresh)
    const domain = listing.items.find((item) => item.name === domainName)
    if (!domain) {
      throw new ApiError(
        'edgeone_acceleration_domain_not_found',
        `EdgeOne acceleration domain ${domainName} not found`,
        404
      )
    }
    return String(domain.cname ?? '')
  }

  /** Upsert the default-line CNAME on the linked DNSPod provider. */
  private async syncCnameRecord(edgeoneProviderId: string, domainName: string, cname: string) {
    return this.safe(async () => {
      const dnspodProviderId = await this.dns.requireDnsPodProviderId(edgeoneProviderId, 'edgeone', 'EdgeOne')
      const fqdn = domainName.toLowerCase().trim()
      const dnspodZone = await this.dns.resolveDnsPodZone(dnspodProviderId, fqdn, 'edgeone')
      if (cname === '') throw new ApiError('edgeone_cname_empty', 'EdgeOne CNAME is empty', 422)

      const record = {
        type: 'CNAME',
        name: fqdn,
        value: cname,
        line: '默认',
        purpose: 'edgeone_cname',
        provider_id: dnspodProviderId,
        remark: `EdgeOne 加速丨${fqdn}`,
      }
      const precleaned = await this.dns.precleanConflicts(dnspodProviderId, dnspodZone, fqdn)
      const result = await this.dns.sync(dnspodProviderId, dnspodZone, record)
      return { domain_name: fqdn, dnspod_zone: dnspodZone, precleaned, record: result }
    })
  }

  /** Delete the default-line CNAME from the linked DNSPod provider. */
  private async cleanupCnameRecord(edgeoneProviderId: string, domainName: string, cname = '') {
    return this.safe(async () => {
      const dnspodProviderId = await this.dns.lookupDnsPodProviderId(edgeoneProviderId, 'edgeone', 'EdgeOne')
      if (dnspodProviderId === '') return { cleaned: 0, records: [], reason: 'dnspod_provider_missing' }

      const fqdn = domainName.toLowerCase().trim()
      let dnspodZone: string
      try {
        dnspodZone = await this.dns.resolveDnsPodZone(dnspodProviderId, fqdn, 'edgeone')
      } catch {
        return { cleaned: 0, records: [], reason: 'dnspod_zone_not_found' }
      }

      if (cname !== '') {
        const record = {
          type: 'CNAME',
          name: fqdn,
          value: cname,
          line: '默认',
          purpose: 'edgeone_cname',
          provider_id: dnspodProviderId,
          remark: `EdgeOne 加速丨${fqdn}`,
        }
        const result = await this.dns.delete(dnspodProviderId, dnspodZone, record)
        return {
          cleaned: result.status === 'deleted' ? 1 : 0,
          dnspod_zone: dnspodZone,
          records: [result],
        }
      }

      const results = await this.dns.deleteRecordsByNameType(dnspodProviderId, dnspodZone, fqdn, 'CNAME', '默认')
      return {
        cleaned: results.filter((record) => record.status === 'deleted').length,
        dnspod_zone: dnspodZone,
        records: results,
      }
    })
  }

  private async preflight(edgeoneProviderId: string, domainName: string) {
    const dnspodProviderId = await this.dns.requireDnsPodProviderId(edgeoneProviderId, 'edgeone', 'EdgeOne')
    const fqdn = domainName.toLowerCase().trim()
    if (fqdn === '') throw new ApiError('validation_failed', 'Domain name is required', 422)
    const dnspodZone = await this.dns.resolveDnsPodZone(dnspodProviderId, fqdn, 'edgeone')
    return { dnspod_provider_id: dnspodProviderId, dnspod_zone: dnspodZone, domain_name: fqdn }
  }

  private normalizeSyncSideEffect(result: Record<string, unknown>, defaultMessage: string): DnsSideEffect {
    let status = String(result.status ?? '')
    const record = (result.record as Record<string, unknown>) ?? {}
    if (status === '' || status === 'completed') {
      const action = String(record.status ?? '')
      if (action === 'failed') status = 'failed'
      else if (action !== '') status = 'completed'
    }
    if (status === '') status = String(result.code ?? '') !== '' ? 'skipped' : 'completed'
    return {
      status: status as DnsSideEffect['status'],
      message: String(result.message ?? defaultMessage),
      details: [result],
    }
  }

  private normalizeCleanupSideEffect(result: Record<string, unknown>, defaultMessage: string): DnsSideEffect {
    if (result.status === 'failed' || String(result.code ?? '') === 'dns_sync_failed') {
      return {
        status: 'failed',
        message: String(result.message ?? (defaultMessage || 'DNS 清理失败')),
        details: [result],
      }
    }
    const cleaned = Number(result.cleaned ?? 0)
    const status = result.status === 'skipped' || result.reason ? 'skipped' : cleaned > 0 ? 'completed' : 'skipped'
    let message = String(result.message ?? '')
    if (message === '') {
      message =
        status === 'completed'
          ? defaultMessage
          : String(result.reason ?? '') !== ''
            ? 'DNS 清理已跳过'
            : '未找到需要清理的 DNS 记录'
    }
    return { status, message, details: [result] }
  }

  private isExplicitProviderNotFound(error: unknown): boolean {
    return (
      error instanceof ApiError &&
      error.code === 'edgeone_request_failed' &&
      isExplicitNotFound(error, /^ResourceNotFound(?:\.|$)/i)
    )
  }

  private async safe<T extends Record<string, unknown>>(fn: () => Promise<T>): Promise<Record<string, unknown>> {
    try {
      return await fn()
    } catch (error) {
      return {
        status: 'failed',
        code: error instanceof ApiError ? error.code : 'dns_sync_failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private normalizeDomainData(data: Record<string, unknown>): AccelerationDomainPayload {
    return normalizeAccelerationDomainPayload(data)
  }

  private buildOriginInfo(data: AccelerationDomainPayload): Record<string, unknown> {
    return buildEdgeOneOriginInfo(data)
  }
}
