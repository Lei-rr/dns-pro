import { ProviderRepository } from '../../provider/repository.js'
import { ApiError } from '../../../lib/http/api-error.js'
import { globalCache } from '../../../lib/cache/cache-service.js'
import { EdgeOneGateway } from '../gateways/gateway.js'
import {
  edgeOneAccelerationDomainSchema,
  edgeoneAccelerationDomainCreateResponseSchema,
  edgeoneAccelerationDomainListResponseSchema,
  edgeoneMutationResponseSchema,
} from '../schemas/response.js'
import type { DnsPodProvider, EdgeOneProvider } from '../../provider/types.js'

const TTL_MS = 3 * 24 * 60 * 60 * 1000

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

export interface AccelerationDomainPayload {
  domain_name?: string
  origin_type?: string
  origin?: string
  host_header?: string
  origin_protocol?: string
  http_origin_port?: number
  https_origin_port?: number
  ipv6_status?: string
}

export class EdgeOneDomainService {
  private credentialCache = new Map<string, DnsPodProvider>()

  constructor(private readonly providers: ProviderRepository = new ProviderRepository()) {}

  async accelerationDomains(providerId: string, zoneId: string, offset = 0, limit = 20, refresh = false): Promise<{ items: EdgeOneAccelerationDomain[]; pagination: Record<string, unknown>; meta: Record<string, unknown> }> {
    const cacheKey = `edgeone:domains:${providerId}:${zoneId}:${offset}:${limit}`
    if (!refresh) {
      const cached = globalCache.get<{ items: EdgeOneAccelerationDomain[]; pagination: Record<string, unknown>; meta: Record<string, unknown> }>(cacheKey)
      if (cached) return cached
    }

    const provider = await this.credentialProvider(providerId)
    const gateway = new EdgeOneGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const response = await gateway.call('DescribeAccelerationDomains', { ZoneId: zoneId, Offset: offset, Limit: limit })
    const parsed = edgeoneAccelerationDomainListResponseSchema.parse(response)

    const items = (parsed.AccelerationDomains ?? []).map((domain) => this.presentDomain(edgeOneAccelerationDomainSchema.parse(domain), zoneId))
    const total = parsed.TotalCount ?? items.length
    const result = {
      items,
      pagination: { offset, limit, total },
      meta: { page: limit > 0 ? Math.floor(offset / limit) + 1 : 1, per_page: limit, offset, limit, total, total_pages: limit > 0 ? Math.ceil(total / limit) : 1 },
      request_id: parsed.RequestId,
    }

    globalCache.set(cacheKey, result, TTL_MS, [`edgeone:domains:${providerId}:${zoneId}`])
    return result
  }

  async createAccelerationDomain(providerId: string, zoneId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const normalized = this.normalizeDomainData(data)
    const provider = await this.credentialProvider(providerId)
    const gateway = new EdgeOneGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const response = await gateway.call('CreateAccelerationDomain', {
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

    globalCache.invalidateTags([`edgeone:domains:${providerId}:${zoneId}`])
    const parsed = edgeoneAccelerationDomainCreateResponseSchema.parse(response)
    return { name: normalized.domain_name, request_id: parsed.RequestId, ownership_verification: parsed.OwnershipVerification ?? null }
  }

  async updateAccelerationDomain(providerId: string, zoneId: string, domainName: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const normalized = this.normalizeDomainData({ ...data, domain_name: domainName })
    const provider = await this.credentialProvider(providerId)
    const gateway = new EdgeOneGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const response = await gateway.call('ModifyAccelerationDomain', {
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

    globalCache.invalidateTags([`edgeone:domains:${providerId}:${zoneId}`])
    return { name: normalized.domain_name, request_id: edgeoneMutationResponseSchema.parse(response).RequestId }
  }

  async deleteAccelerationDomain(providerId: string, zoneId: string, domainName: string): Promise<Record<string, unknown>> {
    const provider = await this.credentialProvider(providerId)
    const gateway = new EdgeOneGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const response = await gateway.call('DeleteAccelerationDomains', {
      ZoneId: zoneId,
      DomainNames: [domainName],
      Force: false,
    })

    globalCache.invalidateTags([`edgeone:domains:${providerId}:${zoneId}`])
    return { name: domainName, request_id: edgeoneMutationResponseSchema.parse(response).RequestId }
  }

  async updateAccelerationDomainStatus(providerId: string, zoneId: string, domainName: string, status: string): Promise<Record<string, unknown>> {
    const provider = await this.credentialProvider(providerId)
    const gateway = new EdgeOneGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const response = await gateway.call('ModifyAccelerationDomainStatuses', {
      ZoneId: zoneId,
      DomainNames: [domainName],
      Status: status,
      Force: false,
    })

    globalCache.invalidateTags([`edgeone:domains:${providerId}:${zoneId}`])
    return { name: domainName, status, request_id: edgeoneMutationResponseSchema.parse(response).RequestId }
  }

  async updateCertificate(providerId: string, zoneId: string, domainName: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const httpsMode = String(data.https_mode ?? '')
    const certId = String(data.cert_id ?? '')
    if (httpsMode === 'sslcert' && certId === '') {
      throw new ApiError('validation_failed', 'Certificate id is required when https_mode is sslcert', 422)
    }

    const provider = await this.credentialProvider(providerId)
    const gateway = new EdgeOneGateway({ secretId: provider.secret_id, secretKey: provider.secret_key })

    const payload: Record<string, unknown> = {
      ZoneId: zoneId,
      Hosts: [domainName],
      Mode: httpsMode,
    }
    if (httpsMode === 'sslcert') {
      payload.ServerCertInfo = [{ CertId: certId }]
    }

    const response = await gateway.call('ModifyHostsCertificate', payload)
    globalCache.invalidateTags([`edgeone:domains:${providerId}:${zoneId}`])
    return { name: domainName, https_mode: httpsMode, request_id: edgeoneMutationResponseSchema.parse(response).RequestId }
  }

  async assignedCname(providerId: string, zoneId: string, domainName: string): Promise<string> {
    const domain = await this.findAccelerationDomain(providerId, zoneId, domainName)
    return String(domain.cname ?? '')
  }

  private async findAccelerationDomain(providerId: string, zoneId: string, domainName: string): Promise<EdgeOneAccelerationDomain> {
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const domains = await this.accelerationDomains(providerId, zoneId, offset, 200)
      for (const domain of domains.items) {
        if (domain.name === domainName) return domain
      }
      hasMore = domains.items.length >= 200
      offset += 200
    }

    throw new ApiError('edgeone_acceleration_domain_not_found', `EdgeOne acceleration domain ${domainName} not found`, 404)
  }

  private async credentialProvider(providerId: string): Promise<DnsPodProvider> {
    const cached = this.credentialCache.get(providerId)
    if (cached) return cached

    const edgeoneProvider = await this.providers.requireType<EdgeOneProvider>(providerId, 'edgeone', 'EdgeOne provider not found', 'edgeone_provider_not_found')
    const dnspodProviderId = edgeoneProvider.dnspod_provider.trim()
    if (dnspodProviderId === '') {
      throw new ApiError('edgeone_dnspod_provider_not_found', 'EdgeOne provider is not linked to a DNSPod provider', 422)
    }

    const dnspodProvider = await this.providers.requireType<DnsPodProvider>(dnspodProviderId, 'dnspod', 'DNSPod provider not found', 'dnspod_provider_not_found')
    this.credentialCache.set(providerId, dnspodProvider)
    return dnspodProvider
  }

  private normalizeDomainData(data: Record<string, unknown>): AccelerationDomainPayload & { domain_name: string } {
    const domainName = String(data.domain_name ?? '').toLowerCase().trim()
    if (domainName === '') throw new ApiError('validation_failed', 'domain_name is required', 422)

    return {
      domain_name: domainName,
      origin: String(data.origin ?? '').trim(),
      origin_type: String(data.origin_type ?? 'IP_DOMAIN').toUpperCase(),
      host_header: String(data.host_header ?? '').toLowerCase().trim(),
      origin_protocol: String(data.origin_protocol ?? 'FOLLOW').toUpperCase(),
      http_origin_port: Number(data.http_origin_port ?? 80),
      https_origin_port: Number(data.https_origin_port ?? 443),
      ipv6_status: String(data.ipv6_status ?? 'follow').toLowerCase(),
    }
  }

  private buildOriginInfo(data: AccelerationDomainPayload): Record<string, unknown> {
    const origin: Record<string, unknown> = {
      OriginType: data.origin_type,
      Origin: data.origin,
    }
    if (data.host_header) origin.HostHeader = data.host_header
    return origin
  }

  private presentDomain(
    domain: import('../schemas/response.js').EdgeOneAccelerationDomain,
    zoneId: string
  ): EdgeOneAccelerationDomain {
    const origin = domain.OriginDetail ?? {}
    const certificate = domain.Certificate ?? {}

    return {
      zone_id: domain.ZoneId ?? zoneId,
      name: domain.DomainName ?? '',
      status: domain.DomainStatus,
      cname: domain.Cname,
      ipv6_status: domain.IPv6Status,
      identification_status: domain.IdentificationStatus,
      origin_protocol: domain.OriginProtocol,
      http_origin_port: domain.HttpOriginPort,
      https_origin_port: domain.HttpsOriginPort,
      origin: {
        type: origin.OriginType,
        value: origin.Origin,
        host_header: origin.HostHeader,
      },
      certificate: {
        mode: certificate.Mode ?? 'disable',
        items: Array.isArray(certificate.List)
          ? certificate.List.map((item: Record<string, unknown>) => ({
              cert_id: item.CertId,
              alias: item.Alias,
              type: item.Type,
              status: item.Status,
              expire_time: item.ExpireTime,
            }))
          : [],
      },
      created_on: domain.CreatedOn,
      modified_on: domain.ModifiedOn,
    }
  }
}
