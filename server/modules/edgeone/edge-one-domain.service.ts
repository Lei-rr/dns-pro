import type { ProviderRepository } from '../../core/providers/provider.repository.js'
import { edgeoneDomainsCacheTag, providerCacheTag, withProviderCache } from '../../core/cache/provider-cache.js'
import { ApiError } from '../../core/http/api-error.js'
import { callProvider, collectOffsetPages, toFullListResult } from '../../core/providers/provider-call.js'
import { providerFiniteNumber, providerOptionalString, providerString } from '../../core/providers/provider-values.js'
import { asRecordArray } from '../../core/providers/response-guards.js'
import { normalizeFqdn } from '../../shared/values.js'
import { invalidateEdgeOneDomainCache } from './edge-one.cache.js'
import type { EdgeOneClient } from './edge-one.client.js'
import { edgeOneClientFor, resolveEdgeOneProvider } from './access.js'
import {
  buildAccelerationDomainRequest,
  normalizeAccelerationDomainPayload,
  normalizeAccelerationDomainUpdatePayload,
} from './edge-one-domain-payload.js'
import {
  edgeOneAccelerationDomainSchema,
  edgeoneAccelerationDomainCreateResponseSchema,
  edgeoneAccelerationDomainListResponseSchema,
  edgeoneMutationResponseSchema,
  type EdgeOneAccelerationDomain as RawDomain,
} from './edge-one-response.schema.js'

/** 变更动作 → 错误码；模板拼接的码无法静态穷举，集中声明为映射常量供架构守卫 ARCH028 收集 */
const EDGEONE_DOMAIN_ACTION_ERROR_CODES = {
  create: 'edgeone_domain_create_failed',
  update: 'edgeone_domain_update_failed',
  delete: 'edgeone_domain_delete_failed',
  status: 'edgeone_domain_status_failed',
  certificate: 'edgeone_domain_certificate_failed',
} as const

type EdgeOneDomainAction = keyof typeof EDGEONE_DOMAIN_ACTION_ERROR_CODES

interface EdgeOneAccelerationDomain {
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

/** 与 core 的 toFullListResult 保持同一形状，避免各服务重复声明分页元数据 */
type DomainListResult = ReturnType<typeof toFullListResult<EdgeOneAccelerationDomain>>

type DomainMutation = { name: string; request_id?: string }

/** EdgeOne 加速域名 CRUD；DNS 副作用由 edge-one-dns-sync 工作流负责 */
export class EdgeOneDomainService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly httpTimeoutMs?: number
  ) {}

  async accelerationDomains(providerId: string, zoneId: string, refresh = false): Promise<DomainListResult> {
    const { dnspodProviderId } = await resolveEdgeOneProvider(this.providers, providerId)
    const cached = await withProviderCache<DomainListResult>({
      // 缓存键与失效标签共用同一构造器，避免字面量各自漂移
      key: edgeoneDomainsCacheTag(providerId, zoneId),
      tags: [
        providerCacheTag(providerId),
        providerCacheTag(dnspodProviderId),
        edgeoneDomainsCacheTag(providerId, zoneId),
      ],
      refresh,
      loader: () => this.fetchAll(providerId, zoneId),
    })
    return cached.value
  }

  /** 读取已分配的 CNAME；域名不存在抛 404 */
  async assignedCname(providerId: string, zoneId: string, domainName: string, refresh = false): Promise<string> {
    const listing = await this.accelerationDomains(providerId, zoneId, refresh)
    // 写入路径统一小写，读取同样归一，避免大小写不同的 URL 被误判为加速域名不存在
    const target = normalizeFqdn(domainName)
    const domain = listing.items.find((item) => normalizeFqdn(item.name) === target)
    if (!domain) {
      throw new ApiError(
        'edgeone_acceleration_domain_not_found',
        `EdgeOne acceleration domain ${domainName} not found`,
        404
      )
    }
    return domain.cname ?? ''
  }

  async createAccelerationDomain(
    providerId: string,
    zoneId: string,
    data: Record<string, unknown>
  ): Promise<DomainMutation & { ownership_verification: unknown }> {
    const normalized = normalizeAccelerationDomainPayload(data)
    const response = await this.mutate(providerId, zoneId, normalized.domain_name, 'create', (client) =>
      client.call('CreateAccelerationDomain', buildAccelerationDomainRequest(zoneId, normalized))
    )
    const parsed = edgeoneAccelerationDomainCreateResponseSchema.parse(response)
    return {
      name: normalized.domain_name,
      request_id: providerOptionalString(parsed.RequestId),
      ownership_verification: parsed.OwnershipVerification ?? null,
    }
  }

  async updateAccelerationDomain(
    providerId: string,
    zoneId: string,
    domainName: string,
    data: Record<string, unknown>
  ): Promise<DomainMutation> {
    // 更新路径只下发显式提供的字段：ModifyAccelerationDomain 对缺省字段的语义是保持原配置。
    // 组装用 update 模式：空串 HostHeader 表示清空自定义 HOST，必须下发而不是省略（见 buildAccelerationDomainRequest）
    const name = normalizeFqdn(domainName)
    const normalized = normalizeAccelerationDomainUpdatePayload({ ...data, domain_name: name })
    const response = await this.mutate(providerId, zoneId, normalized.domain_name, 'update', (client) =>
      client.call('ModifyAccelerationDomain', buildAccelerationDomainRequest(zoneId, normalized, 'update'))
    )
    return { name: normalized.domain_name, request_id: requestIdOf(response) }
  }

  async deleteAccelerationDomain(providerId: string, zoneId: string, domainName: string): Promise<DomainMutation> {
    // 与 create/assignedCname 同源：路径参数域名先归一，否则大小写或尾点不同的 URL 会被上游判为不存在
    const name = normalizeFqdn(domainName)
    const response = await this.mutate(providerId, zoneId, name, 'delete', (client) =>
      client.call('DeleteAccelerationDomains', { ZoneId: zoneId, DomainNames: [name], Force: false })
    )
    return { name, request_id: requestIdOf(response) }
  }

  async updateAccelerationDomainStatus(providerId: string, zoneId: string, domainName: string, status: string) {
    const name = normalizeFqdn(domainName)
    const response = await this.mutate(providerId, zoneId, name, 'status', (client) =>
      client.call('ModifyAccelerationDomainStatuses', {
        ZoneId: zoneId,
        DomainNames: [name],
        Status: status,
        Force: false,
      })
    )
    return { name, status, request_id: requestIdOf(response) }
  }

  async updateCertificate(providerId: string, zoneId: string, domainName: string, data: Record<string, unknown>) {
    const httpsMode = String(data.https_mode ?? '')
    const certId = String(data.cert_id ?? '').trim()
    if (httpsMode === 'sslcert' && certId === '') {
      throw new ApiError('validation_failed', 'Certificate id is required when https_mode is sslcert', 422)
    }
    const name = normalizeFqdn(domainName)
    const payload: Record<string, unknown> = { ZoneId: zoneId, Hosts: [name], Mode: httpsMode }
    if (httpsMode === 'sslcert') payload.ServerCertInfo = [{ CertId: certId }]
    const response = await this.mutate(providerId, zoneId, name, 'certificate', (client) =>
      client.call('ModifyHostsCertificate', payload)
    )
    return { name, https_mode: httpsMode, request_id: requestIdOf(response) }
  }

  /** 统一执行变更：错误码包装 + 缓存失效 */
  private async mutate(
    providerId: string,
    zoneId: string,
    domainName: string,
    action: EdgeOneDomainAction,
    call: (client: EdgeOneClient) => Promise<Record<string, unknown>>
  ): Promise<Record<string, unknown>> {
    const client = await edgeOneClientFor(this.providers, providerId, this.httpTimeoutMs)
    const response = await callProvider(
      {
        code: EDGEONE_DOMAIN_ACTION_ERROR_CODES[action],
        message: `EdgeOne acceleration domain ${action} failed`,
        providerId,
        details: { zone: zoneId, domain: domainName },
      },
      () => call(client)
    )
    invalidateEdgeOneDomainCache(providerId, zoneId)
    return response
  }

  private async fetchAll(providerId: string, zoneId: string): Promise<DomainListResult> {
    const client = await edgeOneClientFor(this.providers, providerId, this.httpTimeoutMs)
    const { items, requestId } = await collectOffsetPages(
      async (offset, limit) => {
        const response = await callProvider(
          {
            code: 'edgeone_domain_list_failed',
            message: 'EdgeOne acceleration domain list failed',
            providerId,
            details: { zone: zoneId },
          },
          () => client.call('DescribeAccelerationDomains', { ZoneId: zoneId, Offset: offset, Limit: limit })
        )
        const parsed = edgeoneAccelerationDomainListResponseSchema.parse(response)
        return {
          items: (parsed.AccelerationDomains as unknown[]).map((domain) =>
            presentDomain(edgeOneAccelerationDomainSchema.parse(domain), zoneId)
          ),
          sourceCount: Number(parsed.SourceCount ?? 0),
          requestId: parsed.RequestId ?? undefined,
        }
      },
      { limitCode: 'edgeone_pagination_limit', limitMessage: 'EdgeOne pagination limit reached' }
    )
    return toFullListResult(items, requestId)
  }
}

function requestIdOf(response: unknown): string | undefined {
  return providerOptionalString(edgeoneMutationResponseSchema.parse(response).RequestId)
}

function presentDomain(domain: RawDomain, zoneId: string): EdgeOneAccelerationDomain {
  const origin = domain.OriginDetail
  const certificate = domain.Certificate
  const optionalPort = (value: unknown) => (value == null ? undefined : providerFiniteNumber(value))
  return {
    zone_id: providerString(domain.ZoneId, zoneId),
    name: providerString(domain.DomainName),
    status: providerOptionalString(domain.DomainStatus),
    cname: providerOptionalString(domain.Cname),
    ipv6_status: providerOptionalString(domain.IPv6Status),
    identification_status: providerOptionalString(domain.IdentificationStatus),
    origin_protocol: providerOptionalString(domain.OriginProtocol),
    http_origin_port: optionalPort(domain.HttpOriginPort),
    https_origin_port: optionalPort(domain.HttpsOriginPort),
    origin: {
      type: providerOptionalString(origin.OriginType),
      value: providerOptionalString(origin.Origin),
      host_header: providerOptionalString(origin.HostHeader),
    },
    certificate: {
      mode: providerString(certificate.Mode, 'disable'),
      items: asRecordArray(certificate.List).map((item) => ({
        cert_id: providerOptionalString(item.CertId),
        alias: providerOptionalString(item.Alias),
        type: providerOptionalString(item.Type),
        status: providerOptionalString(item.Status),
        expire_time: providerOptionalString(item.ExpireTime),
      })),
    },
    created_on: providerOptionalString(domain.CreatedOn),
    modified_on: providerOptionalString(domain.ModifiedOn),
  }
}
