import type { ProviderRepository } from '../../../kernel/providers/provider.repository.js'
import { cloudflareClientFor } from '../cloudflare.client.js'
import {
  cloudflareCustomHostnameSchema,
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
  type CloudflarePage,
} from '../cloudflare-response.schema.js'
import {
  customHostnameDetailsCacheTag,
  customHostnameListCacheTag,
  providerCacheTag,
  withProviderCache,
} from '../../../kernel/cache/provider-cache.js'
import { ApiError } from '../../../kernel/http/api-error.js'
import { normalizeFqdn } from '../../../lib/values.js'
import { callProvider, collectNumberedPages } from '../../../kernel/providers/provider-call.js'
import { providerOptionalString, providerString } from '../../../kernel/providers/provider-values.js'
import { asRecord, asRecordArray } from '../../../kernel/providers/response-guards.js'

const PAGE_LIMIT = { limitCode: 'cloudflare_pagination_limit', limitMessage: 'Cloudflare pagination limit reached' }

interface DcvDelegationRecord {
  cname: string
  cname_target: string
  [key: string]: unknown
}

interface CustomHostnameSsl {
  type?: string
  method?: string
  status?: string
  dcv_delegation_uuid?: string
  dcv_delegation_records?: DcvDelegationRecord[]
  certificates?: Record<string, unknown>[]
  expires_on?: string
  issuer?: string
  settings?: Record<string, unknown>
  [key: string]: unknown
}

interface CustomHostnameOwnership {
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
  ssl?: CustomHostnameSsl
  ownership_verification?: CustomHostnameOwnership | null
  custom_metadata?: Record<string, unknown> | null
  preferred_domain?: string
  auto_preferred?: boolean
  [key: string]: unknown
}

const hostnamesPath = (zoneId: string, hostnameId?: string) =>
  `zones/${encodeURIComponent(zoneId)}/custom_hostnames${hostnameId ? `/${encodeURIComponent(hostnameId)}` : ''}`

/** Cloudflare for SaaS 自定义主机名 API */
export class SaaSCustomHostnameClient {
  constructor(private readonly providers: ProviderRepository) {}

  async listAll(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<CloudflareCustomHostname[]> {
    return collectNumberedPages(
      (page, perPage) => this.page(cloudflareProviderId, zoneId, page, perPage, refresh),
      PAGE_LIMIT
    )
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
        const response = await this.call(
          cloudflareProviderId,
          'show',
          { zone: zoneId, hostname_id: hostnameId },
          (client) => client.get(hostnamesPath(zoneId, hostnameId))
        )
        return presentHostname(parseCloudflareItemResponse(response).result)
      },
    })
    return cached.value
  }

  /** FQDN → 主机名 ID；缓存未命中时强制刷新再查一次 */
  async idByHostname(cloudflareProviderId: string, zoneId: string, hostnameFqdn: string, refresh = false) {
    const fqdn = normalizeFqdn(hostnameFqdn)
    const found =
      (await this.findId(cloudflareProviderId, zoneId, fqdn, refresh)) ||
      (!refresh ? await this.findId(cloudflareProviderId, zoneId, fqdn, true) : '')
    if (found) return found
    throw new ApiError('saas_hostname_not_found', `Hostname ${hostnameFqdn} not found`, 404)
  }

  async create(cloudflareProviderId: string, zoneId: string, data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      hostname: String(data.hostname ?? '').trim(),
      ssl: { type: 'dv', ...sslPatch(data) },
    }
    const customOrigin = String(data.custom_origin_server ?? '').trim()
    if (customOrigin) payload.custom_origin_server = customOrigin

    const response = await this.call(cloudflareProviderId, 'create', { zone: zoneId }, (client) =>
      client.post(hostnamesPath(zoneId), payload)
    )
    return presentHostname(parseCloudflareItemResponse(response).result)
  }

  async update(cloudflareProviderId: string, zoneId: string, hostnameId: string, data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {}
    if (Object.hasOwn(data, 'custom_origin_server')) {
      // 空串表示清除自定义回源
      payload.custom_origin_server = String(data.custom_origin_server ?? '').trim() || null
    }
    const ssl = sslPatch(data)
    if (Object.keys(ssl).length > 0) payload.ssl = { type: 'dv', ...ssl }

    const response = await this.call(
      cloudflareProviderId,
      'update',
      { zone: zoneId, hostname_id: hostnameId },
      (client) => client.patch(hostnamesPath(zoneId, hostnameId), payload)
    )
    return presentHostname(parseCloudflareItemResponse(response).result)
  }

  async delete(cloudflareProviderId: string, zoneId: string, hostnameId: string): Promise<{ id: string }> {
    await this.call(cloudflareProviderId, 'delete', { zone: zoneId, hostname_id: hostnameId }, (client) =>
      client.delete(hostnamesPath(zoneId, hostnameId))
    )
    return { id: hostnameId }
  }

  private async page(
    cloudflareProviderId: string,
    zoneId: string,
    page: number,
    perPage: number,
    refresh: boolean
  ): Promise<CloudflarePage<CloudflareCustomHostname>> {
    const cached = await withProviderCache<CloudflarePage<CloudflareCustomHostname>>({
      key: `cloudflare:custom_hostnames:${cloudflareProviderId}:${zoneId}:${page}:${perPage}`,
      tags: [providerCacheTag(cloudflareProviderId), customHostnameListCacheTag(cloudflareProviderId, zoneId)],
      refresh,
      loader: async () => {
        const response = await this.call(cloudflareProviderId, 'list', { zone: zoneId }, (client) =>
          client.get(hostnamesPath(zoneId), { page, per_page: perPage })
        )
        return parseCloudflareListResponse(response, presentHostname)
      },
    })
    return cached.value
  }

  private async findId(cloudflareProviderId: string, zoneId: string, fqdn: string, refresh: boolean) {
    let found = ''
    await collectNumberedPages((page, perPage) => this.page(cloudflareProviderId, zoneId, page, perPage, refresh), {
      ...PAGE_LIMIT,
      stop: (items) => {
        found = items.find((item) => normalizeFqdn(item.hostname) === fqdn && item.id)?.id ?? ''
        return found !== ''
      },
    })
    return found
  }

  private async call<T>(
    cloudflareProviderId: string,
    action: 'list' | 'show' | 'create' | 'update' | 'delete',
    details: Record<string, unknown>,
    fn: (client: Awaited<ReturnType<typeof cloudflareClientFor>>['client']) => Promise<T>
  ): Promise<T> {
    const { client } = await cloudflareClientFor(this.providers, cloudflareProviderId)
    return callProvider(
      {
        code: `saas_hostname_${action}_failed`,
        message: `Cloudflare custom hostname ${action} failed`,
        providerId: cloudflareProviderId,
        details,
      },
      () => fn(client)
    )
  }
}

function sslPatch(data: Record<string, unknown>): Record<string, unknown> {
  const ssl: Record<string, unknown> = {}
  if (data.method) ssl.method = String(data.method)
  if (data.min_tls_version) ssl.settings = { min_tls_version: String(data.min_tls_version) }
  return ssl
}

function presentHostname(hostname: unknown): CloudflareCustomHostname {
  const parsed = cloudflareCustomHostnameSchema.parse(hostname)
  const ssl = asRecord(parsed.ssl)
  const certificates = asRecordArray(ssl.certificates)
  const firstCert = certificates[0] ?? {}
  const ownership = asRecord(parsed.ownership_verification)
  const metadata = parsed.custom_metadata

  return {
    ...parsed,
    id: providerString(parsed.id),
    hostname: providerString(parsed.hostname),
    status: providerOptionalString(parsed.status),
    custom_origin_server: providerOptionalString(parsed.custom_origin_server),
    ssl: {
      ...ssl,
      settings: asRecord(ssl.settings),
      dcv_delegation_records: asRecordArray(ssl.dcv_delegation_records).map((record) => ({
        ...record,
        cname: providerString(record.cname),
        cname_target: providerString(record.cname_target),
      })),
      validation_records: asRecordArray(ssl.validation_records),
      certificates,
      expires_on: providerOptionalString(firstCert.expires_on ?? ssl.expires_on ?? undefined),
      issuer: providerOptionalString(firstCert.issuer ?? ssl.issuer ?? undefined),
    },
    ownership_verification: {
      ...ownership,
      type: providerOptionalString(ownership.type),
      name: providerOptionalString(ownership.name),
      value: providerOptionalString(ownership.value),
    },
    custom_metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null,
  }
}
