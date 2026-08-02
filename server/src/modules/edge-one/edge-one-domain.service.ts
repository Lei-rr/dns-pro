import { ProviderRepository } from '../providers/provider.repository.js'
import type { DnsPodProvider, EdgeOneProvider } from '../providers/provider.types.js'
import { ApiError } from '../../shared/http/api-error.js'
import { wrapProviderError } from '../../shared/http/wrap-provider-error.js'
import { edgeoneDomainsCacheTag, providerCacheTag, withProviderCache } from '../../platform/cache/provider-cache.js'
import { invalidateEdgeOneDomainCache } from './edge-one.cache.js'
import { EdgeOneGateway } from './edge-one.client.js'
import {
  edgeOneAccelerationDomainSchema,
  edgeoneAccelerationDomainListResponseSchema,
  edgeoneMutationResponseSchema,
} from './edge-one-response.schema.js'
import { providerOptionalString, providerString } from '../../shared/providers/provider-values.js'
import { resolveEdgeOneApiCredentials } from './edge-one-credentials.js'
import {
  buildEdgeOneOriginInfo,
  normalizeAccelerationDomainPayload,
  type AccelerationDomainPayload,
} from './edge-one-domain-payload.js'

export interface EdgeOneAccelerationDomain {
  zone_id: string
  name: string
  status?: string
  cname?: string
  ipv6_status?: string
  identification_status?: string
  origin_protocol?: string
  http_origin_port?: number
  https_origin_port?: number
  origin?: Record<string, unknown>
  certificate?: Record<string, unknown>
  created_on?: string
  modified_on?: string
}

export class EdgeOneDomainService {
  constructor(private readonly providers: ProviderRepository) {}

  async accelerationDomains(
    providerId: string,
    zoneId: string,
    refresh = false
  ): Promise<{
    items: EdgeOneAccelerationDomain[]
    pagination: Record<string, unknown>
    meta: Record<string, unknown>
  }> {
    const edgeoneProvider = await this.providers.requireType<EdgeOneProvider>(providerId, 'edgeone')
    const linkedProviderId = edgeoneProvider.dnspod_provider.trim()
    const cached = await withProviderCache<{
      items: EdgeOneAccelerationDomain[]
      pagination: Record<string, unknown>
      meta: Record<string, unknown>
      request_id?: string
    }>({
      key: `edgeone:domains:${providerId}:${zoneId}`,
      tags: [
        providerCacheTag(providerId),
        providerCacheTag(linkedProviderId),
        edgeoneDomainsCacheTag(providerId, zoneId),
      ],
      refresh,
      loader: async () => {
        const provider = await resolveEdgeOneApiCredentials(this.providers, providerId)
        const gateway = this.gatewayFor(provider)
        const pageSize = 100
        const items: EdgeOneAccelerationDomain[] = []
        let offset = 0
        let pages = 0
        let requestId: string | undefined

        while (true) {
          let response
          try {
            response = await gateway.call('DescribeAccelerationDomains', {
              ZoneId: zoneId,
              Offset: offset,
              Limit: pageSize,
            })
          } catch (error) {
            throw wrapProviderError(
              'edgeone_domain_list_failed',
              'EdgeOne acceleration domain list failed',
              providerId,
              error,
              { zone: zoneId }
            )
          }
          const parsed = edgeoneAccelerationDomainListResponseSchema.parse(response)
          pages++
          const sourceCount = Number(parsed.SourceCount ?? 0)
          const pageItems = (Array.isArray(parsed.AccelerationDomains) ? parsed.AccelerationDomains : []).map(
            (domain) => this.presentDomain(edgeOneAccelerationDomainSchema.parse(domain), zoneId)
          )
          items.push(...pageItems)
          const totalRaw = parsed.TotalCount
          const totalValue = Number(totalRaw)
          const total =
            totalRaw != null && totalRaw !== '' && Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : null
          requestId = parsed.RequestId ?? requestId
          offset += sourceCount
          if (sourceCount < pageSize || (total !== null && offset >= total)) break
          if (pages >= 1000) throw new ApiError('edgeone_pagination_limit', 'EdgeOne pagination limit reached', 502)
        }

        return {
          items,
          pagination: { offset: 0, limit: items.length, total: items.length },
          meta: {
            page: 1,
            per_page: items.length,
            offset: 0,
            limit: items.length,
            total: items.length,
            total_pages: 1,
          },
          request_id: requestId,
        }
      },
    })
    return cached.value
  }

  async updateAccelerationDomain(
    providerId: string,
    zoneId: string,
    domainName: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const normalized = this.normalizeDomainData({ ...data, domain_name: domainName })
    const provider = await resolveEdgeOneApiCredentials(this.providers, providerId)
    const gateway = this.gatewayFor(provider)

    let response
    try {
      response = await gateway.call('ModifyAccelerationDomain', {
        ZoneId: zoneId,
        DomainName: normalized.domain_name,
        OriginInfo: this.buildOriginInfo(normalized),
        OriginProtocol: normalized.origin_protocol,
        IPv6Status: normalized.ipv6_status,
        ...(normalized.origin_protocol === 'FOLLOW' || normalized.origin_protocol === 'HTTP'
          ? { HttpOriginPort: normalized.http_origin_port }
          : {}),
        ...(normalized.origin_protocol === 'FOLLOW' || normalized.origin_protocol === 'HTTPS'
          ? { HttpsOriginPort: normalized.https_origin_port }
          : {}),
      })
    } catch (error) {
      throw wrapProviderError(
        'edgeone_domain_update_failed',
        'EdgeOne acceleration domain update failed',
        providerId,
        error,
        {
          zone: zoneId,
          domain: normalized.domain_name,
        }
      )
    }

    const parsed = edgeoneMutationResponseSchema.parse(response)
    const result = { name: normalized.domain_name, request_id: providerOptionalString(parsed.RequestId) }
    invalidateEdgeOneDomainCache(providerId, zoneId)
    return result
  }

  async updateAccelerationDomainStatus(
    providerId: string,
    zoneId: string,
    domainName: string,
    status: string
  ): Promise<Record<string, unknown>> {
    const provider = await resolveEdgeOneApiCredentials(this.providers, providerId)
    const gateway = this.gatewayFor(provider)

    let response
    try {
      response = await gateway.call('ModifyAccelerationDomainStatuses', {
        ZoneId: zoneId,
        DomainNames: [domainName],
        Status: status,
        Force: false,
      })
    } catch (error) {
      throw wrapProviderError(
        'edgeone_domain_status_failed',
        'EdgeOne acceleration domain status update failed',
        providerId,
        error,
        {
          zone: zoneId,
          domain: domainName,
        }
      )
    }

    const parsed = edgeoneMutationResponseSchema.parse(response)
    const result = { name: domainName, status, request_id: providerOptionalString(parsed.RequestId) }
    invalidateEdgeOneDomainCache(providerId, zoneId)
    return result
  }

  async updateCertificate(
    providerId: string,
    zoneId: string,
    domainName: string,
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const httpsMode = String(data.https_mode ?? '')
    const certId = String(data.cert_id ?? '')
    if (httpsMode === 'sslcert' && certId === '') {
      throw new ApiError('validation_failed', 'Certificate id is required when https_mode is sslcert', 422)
    }

    const provider = await resolveEdgeOneApiCredentials(this.providers, providerId)
    const gateway = this.gatewayFor(provider)

    const payload: Record<string, unknown> = {
      ZoneId: zoneId,
      Hosts: [domainName],
      Mode: httpsMode,
    }
    if (httpsMode === 'sslcert') {
      payload.ServerCertInfo = [{ CertId: certId }]
    }

    let response
    try {
      response = await gateway.call('ModifyHostsCertificate', payload)
    } catch (error) {
      throw wrapProviderError(
        'edgeone_domain_certificate_failed',
        'EdgeOne certificate update failed',
        providerId,
        error,
        {
          zone: zoneId,
          domain: domainName,
        }
      )
    }
    invalidateEdgeOneDomainCache(providerId, zoneId)
    return {
      name: domainName,
      https_mode: httpsMode,
      request_id: edgeoneMutationResponseSchema.parse(response).RequestId,
    }
  }

  private normalizeDomainData(data: Record<string, unknown>): AccelerationDomainPayload & { domain_name: string } {
    return normalizeAccelerationDomainPayload(data)
  }

  private buildOriginInfo(data: AccelerationDomainPayload): Record<string, unknown> {
    return buildEdgeOneOriginInfo(data)
  }

  private presentDomain(
    domain: import('./edge-one-response.schema.js').EdgeOneAccelerationDomain,
    zoneId: string
  ): EdgeOneAccelerationDomain {
    const origin = domain.OriginDetail ?? {}
    const certificate = domain.Certificate ?? {}

    return {
      zone_id: this.scalarString(domain.ZoneId, zoneId),
      name: this.scalarString(domain.DomainName),
      status: providerOptionalString(domain.DomainStatus),
      cname: providerOptionalString(domain.Cname),
      ipv6_status: providerOptionalString(domain.IPv6Status),
      identification_status: providerOptionalString(domain.IdentificationStatus),
      origin_protocol: providerOptionalString(domain.OriginProtocol),
      http_origin_port: domain.HttpOriginPort == null ? undefined : this.finiteNumber(domain.HttpOriginPort),
      https_origin_port: domain.HttpsOriginPort == null ? undefined : this.finiteNumber(domain.HttpsOriginPort),
      origin: {
        type: providerOptionalString(origin.OriginType),
        value: providerOptionalString(origin.Origin),
        host_header: providerOptionalString(origin.HostHeader),
      },
      certificate: {
        mode: providerString(certificate.Mode, 'disable'),
        items: Array.isArray(certificate.List)
          ? certificate.List.filter(
              (value: unknown): value is Record<string, unknown> =>
                Boolean(value) && typeof value === 'object' && !Array.isArray(value)
            ).map((item: Record<string, unknown>) => ({
              cert_id: providerOptionalString(item.CertId),
              alias: providerOptionalString(item.Alias),
              type: providerOptionalString(item.Type),
              status: providerOptionalString(item.Status),
              expire_time: providerOptionalString(item.ExpireTime),
            }))
          : [],
      },
      created_on: providerOptionalString(domain.CreatedOn),
      modified_on: providerOptionalString(domain.ModifiedOn),
    }
  }

  private scalarString(value: unknown, fallback = ''): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
  }

  private finiteNumber(value: unknown): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  private gatewayFor(provider: DnsPodProvider): EdgeOneGateway {
    return EdgeOneGateway.forCredentials({
      secretId: provider.secret_id,
      secretKey: provider.secret_key,
    })
  }
}
