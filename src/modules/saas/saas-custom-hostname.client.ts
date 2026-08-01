import { ProviderRepository } from '../providers/provider.repository.js'
import { CloudflareGateway } from '../cloudflare/cloudflare.client.js'
import {
  customHostnameDetailsCacheTag,
  customHostnameListCacheTag,
  providerCacheTag,
  withProviderCache,
} from '../../platform/cache/provider-cache.js'
import { ApiError } from '../../shared/http/api-error.js'
import { wrapProviderError } from '../../shared/http/wrap-provider-error.js'
import {
  cloudflareCustomHostnameSchema,
  cloudflareResultInfoSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../cloudflare/cloudflare-response.schema.js'
import type { CloudflareProvider } from '../providers/provider.types.js'
import { providerOptionalString, providerString } from '../../shared/providers/provider-values.js'

export interface CloudflareCustomHostnameSslDcvDelegationRecord {
  cname: string
  cname_target: string
  [key: string]: unknown
}

export interface CloudflareCustomHostnameSsl {
  type?: string
  method?: string
  status?: string
  dcv_delegation_uuid?: string
  dcv_delegation_records?: CloudflareCustomHostnameSslDcvDelegationRecord[]
  certificates?: Record<string, unknown>[]
  expires_on?: string
  issuer?: string
  settings?: Record<string, unknown>
  [key: string]: unknown
}

export interface CloudflareCustomHostnameOwnership {
  type?: string
  name?: string
  value?: string
  [key: string]: unknown
}

export interface CloudflareCustomHostname {
  id: string
  hostname: string
  status?: string
  custom_origin_server?: string | null
  ssl?: CloudflareCustomHostnameSsl
  ownership_verification?: CloudflareCustomHostnameOwnership | null
  custom_metadata?: Record<string, unknown> | null
  previous_status?: string
  preferred_domain?: string
  auto_preferred?: boolean
  [key: string]: unknown
}

export class CloudflareCustomHostnameGateway {
  constructor(private readonly providers: ProviderRepository) {}

  async list(
    cloudflareProviderId: string,
    zoneId: string,
    page = 1,
    perPage = 100,
    refresh = false
  ): Promise<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown> }> {
    const tag = customHostnameListCacheTag(cloudflareProviderId, zoneId)
    // refresh flag on withProviderCache already bypasses memory; no pre-invalidate needed.

    const cached = await withProviderCache<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown> }>({
      key: `cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}:${page}:${perPage}`,
      tags: [providerCacheTag(cloudflareProviderId), tag],
      refresh,
      loader: async () => {
        const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
        const gateway = this.gatewayFor(provider)

        let response
        try {
          response = await gateway.get(`zones/${encodeURIComponent(zoneId)}/custom_hostnames`, {
            page,
            per_page: perPage,
          })
        } catch (error) {
          throw wrapProviderError(
            'saas_hostname_list_failed',
            'Cloudflare custom hostname list failed',
            cloudflareProviderId,
            error,
            { zone: zoneId }
          )
        }

        const parsed = parseCloudflareListResponse(response)
        const resultInfo = parsed.result_info ?? cloudflareResultInfoSchema.parse({})
        const items = parsed.result.map((hostname) => this.present(hostname))
        return {
          items,
          pagination: {
            page: resultInfo.page ?? page,
            per_page: resultInfo.per_page ?? perPage,
            source_count: parsed.source_count,
            total_count: resultInfo.total_count,
            total_pages: resultInfo.total_pages,
          },
        }
      },
    })
    return cached.value
  }

  async listAll(
    cloudflareProviderId: string,
    zoneId: string,
    refresh = false
  ): Promise<{ items: CloudflareCustomHostname[]; pagination: Record<string, unknown> }> {
    const pageSize = 100
    const items: CloudflareCustomHostname[] = []
    let page = 1

    while (true) {
      const result = await this.list(cloudflareProviderId, zoneId, page, pageSize, refresh)
      items.push(...result.items)
      const totalPages = Number(result.pagination.total_pages ?? 0)
      const sourceCount = Number(result.pagination.source_count ?? result.items.length)
      if (totalPages > 0 ? page >= totalPages : sourceCount < pageSize) break
      if (page >= 1000) throw new ApiError('cloudflare_pagination_limit', 'Cloudflare pagination limit reached', 502)
      page++
    }
    return {
      items,
      pagination: { page: 1, per_page: items.length, total_count: items.length, total_pages: 1 },
    }
  }

  async show(
    cloudflareProviderId: string,
    zoneId: string,
    hostnameId: string,
    refresh = false
  ): Promise<CloudflareCustomHostname> {
    const cached = await withProviderCache<CloudflareCustomHostname>({
      key: `cloudflare:custom_hostname:${cloudflareProviderId}:${zoneId}:${hostnameId}`,
      tags: [providerCacheTag(cloudflareProviderId), customHostnameDetailsCacheTag(cloudflareProviderId, zoneId)],
      refresh,
      loader: async () => {
        const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
        const gateway = this.gatewayFor(provider)

        let response
        try {
          response = await gateway.get(
            `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`
          )
        } catch (error) {
          throw wrapProviderError(
            'saas_hostname_show_failed',
            'Cloudflare custom hostname show failed',
            cloudflareProviderId,
            error,
            { zone: zoneId, hostname_id: hostnameId }
          )
        }
        return this.present(parseCloudflareItemResponse(response).result)
      },
    })
    return cached.value
  }

  async idByHostname(
    cloudflareProviderId: string,
    zoneId: string,
    hostnameFqdn: string,
    refresh = false
  ): Promise<string> {
    const normalized = hostnameFqdn.toLowerCase().trim()

    const found = await this.findIdInList(cloudflareProviderId, zoneId, normalized, refresh)
    if (found) return found

    if (!refresh) {
      const refreshed = await this.findIdInList(cloudflareProviderId, zoneId, normalized, true)
      if (refreshed) return refreshed
    }

    throw new ApiError('saas_hostname_not_found', `Hostname ${hostnameFqdn} not found`, 404)
  }

  async create(
    cloudflareProviderId: string,
    zoneId: string,
    data: Record<string, unknown>
  ): Promise<CloudflareCustomHostname> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = this.gatewayFor(provider)

    const payload: Record<string, unknown> = { hostname: String(data.hostname ?? '').trim() }
    const ssl: Record<string, unknown> = { type: 'dv' }
    if (data.method) ssl.method = String(data.method)
    if (data.min_tls_version) ssl.settings = { min_tls_version: String(data.min_tls_version) }
    payload.ssl = ssl

    const customOrigin = String(data.custom_origin_server ?? '').trim()
    if (customOrigin) payload.custom_origin_server = customOrigin

    let response
    try {
      response = await gateway.post(`zones/${encodeURIComponent(zoneId)}/custom_hostnames`, payload)
    } catch (error) {
      throw wrapProviderError(
        'saas_hostname_create_failed',
        'Cloudflare custom hostname create failed',
        cloudflareProviderId,
        error,
        { zone: zoneId }
      )
    }

    return this.present(parseCloudflareItemResponse(response).result)
  }

  async update(
    cloudflareProviderId: string,
    zoneId: string,
    hostnameId: string,
    data: Record<string, unknown>
  ): Promise<CloudflareCustomHostname> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = this.gatewayFor(provider)

    const payload: Record<string, unknown> = {}
    if (Object.prototype.hasOwnProperty.call(data, 'custom_origin_server')) {
      const customOrigin = String(data.custom_origin_server ?? '').trim()
      payload.custom_origin_server = customOrigin !== '' ? customOrigin : null
    }

    const ssl: Record<string, unknown> = {}
    if (data.method) ssl.method = String(data.method)
    if (data.min_tls_version) ssl.settings = { min_tls_version: String(data.min_tls_version) }
    if (Object.keys(ssl).length > 0) {
      ssl.type = 'dv'
      payload.ssl = ssl
    }

    let response
    try {
      response = await gateway.patch(
        `zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`,
        payload
      )
    } catch (error) {
      throw wrapProviderError(
        'saas_hostname_update_failed',
        'Cloudflare custom hostname update failed',
        cloudflareProviderId,
        error,
        { zone: zoneId, hostname_id: hostnameId }
      )
    }

    return this.present(parseCloudflareItemResponse(response).result)
  }

  async delete(cloudflareProviderId: string, zoneId: string, hostnameId: string): Promise<{ id: string }> {
    const provider = await this.providers.requireType<CloudflareProvider>(cloudflareProviderId, 'cloudflare')
    const gateway = this.gatewayFor(provider)

    try {
      await gateway.delete(`zones/${encodeURIComponent(zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`)
    } catch (error) {
      throw wrapProviderError(
        'saas_hostname_delete_failed',
        'Cloudflare custom hostname delete failed',
        cloudflareProviderId,
        error,
        { zone: zoneId, hostname_id: hostnameId }
      )
    }

    return { id: hostnameId }
  }

  private async findIdInList(
    cloudflareProviderId: string,
    zoneId: string,
    fqdn: string,
    refresh: boolean
  ): Promise<string | null> {
    let page = 1
    let hasMore = true
    while (hasMore) {
      const result = await this.list(cloudflareProviderId, zoneId, page, 100, refresh)
      for (const item of result.items) {
        if (item.hostname.toLowerCase() === fqdn && item.id) {
          return item.id
        }
      }
      const totalPages = Number(result.pagination.total_pages ?? 1)
      hasMore = page < totalPages
      page++
      if (page > 1000) throw new ApiError('cloudflare_pagination_limit', 'Cloudflare pagination limit reached', 502)
    }
    return null
  }

  private present(hostname: unknown): CloudflareCustomHostname {
    const parsed = cloudflareCustomHostnameSchema.parse(hostname)
    const sslInput =
      parsed.ssl && typeof parsed.ssl === 'object' && !Array.isArray(parsed.ssl)
        ? (parsed.ssl as Record<string, unknown>)
        : {}
    const certificates = Array.isArray(sslInput.certificates) ? sslInput.certificates : []
    const firstCertificate = certificates[0]
    const firstCert =
      firstCertificate && typeof firstCertificate === 'object' && !Array.isArray(firstCertificate)
        ? (firstCertificate as Record<string, unknown>)
        : {}
    const ownershipInput = parsed.ownership_verification
    const ownership =
      ownershipInput && typeof ownershipInput === 'object' && !Array.isArray(ownershipInput)
        ? (ownershipInput as Record<string, unknown>)
        : {}

    const ssl: CloudflareCustomHostnameSsl = {
      ...sslInput,
      settings:
        sslInput.settings && typeof sslInput.settings === 'object' && !Array.isArray(sslInput.settings)
          ? (sslInput.settings as Record<string, unknown>)
          : {},
      dcv_delegation_records: this.recordArray(sslInput.dcv_delegation_records).map((record) => ({
        ...record,
        cname: providerString(record.cname),
        cname_target: providerString(record.cname_target),
      })),
      validation_records: this.recordArray(sslInput.validation_records),
      certificates: this.recordArray(certificates),
      expires_on:
        firstCert.expires_on == null && sslInput.expires_on == null
          ? undefined
          : providerOptionalString(firstCert.expires_on ?? sslInput.expires_on),
      issuer:
        firstCert.issuer == null && sslInput.issuer == null
          ? undefined
          : providerOptionalString(firstCert.issuer ?? sslInput.issuer),
    }

    return {
      ...parsed,
      id: providerString(parsed.id),
      hostname: providerString(parsed.hostname),
      status: providerOptionalString(parsed.status),
      custom_origin_server: providerOptionalString(parsed.custom_origin_server),
      ssl,
      ownership_verification: {
        ...ownership,
        type: providerOptionalString(ownership.type),
        name: providerOptionalString(ownership.name),
        value: providerOptionalString(ownership.value),
      },
      custom_metadata:
        parsed.custom_metadata && typeof parsed.custom_metadata === 'object' && !Array.isArray(parsed.custom_metadata)
          ? parsed.custom_metadata
          : null,
    }
  }

  private recordArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return []
    return value.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
  }

  private gatewayFor(provider: CloudflareProvider): CloudflareGateway {
    return CloudflareGateway.forToken(provider.api_token)
  }
}
