import type { CloudflareClient } from '../cloudflare.client.js'
import type { CloudflareAccess } from '../access.js'
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
} from '../../../core/cache/provider-cache.js'
import { ApiError } from '../../../core/http/api-error.js'
import { normalizeFqdn } from '../../../shared/values.js'
import { callProvider, collectNumberedPages } from '../../../core/providers/provider-call.js'
import { CLOUDFLARE_PAGE_LIMIT } from '../cloudflare-pagination.js'
import { CLOUDFLARE_PROVIDER_TYPE } from '../cloudflare.cache.js'
import { providerOptionalString, providerString } from '../../../core/providers/provider-values.js'
import { asRecord, asRecordArray, asRecordOrNull } from '../../../core/providers/response-guards.js'

/** 变更动作 → 错误码；模板拼接的码无法静态穷举，集中声明为映射常量供架构守卫 ARCH028 收集 */
const SAAS_HOSTNAME_ACTION_ERROR_CODES = {
  list: 'saas_hostname_list_failed',
  show: 'saas_hostname_show_failed',
  create: 'saas_hostname_create_failed',
  update: 'saas_hostname_update_failed',
  delete: 'saas_hostname_delete_failed',
} as const

type SaasHostnameAction = keyof typeof SAAS_HOSTNAME_ACTION_ERROR_CODES

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
  /** 读路径合并本地偏好后注入的显式同步配置（非 Cloudflare 上游字段） */
  sync_target?: string
  sync_provider_id?: string
  sync_zone?: string
  /** 生效同步配置派生字段（默认值补全 + 脏配置修复后的结果） */
  effective_sync_target?: string
  effective_sync_provider_id?: string
  effective_sync_zone?: string
  /** 远端已成功、本地偏好写入失败时的降级标记 */
  local_preference_error?: string
  [key: string]: unknown
}

/**
 * 站点主机名索引快照：一次拉取、多次匹配，匹配本身不再产生上游请求。
 * 批量查找（一个 FQDN 对多个站点）靠它把「刷新策略」挡在查找之外，
 * 否则每个未命中的站点都会各自决定刷新一次。
 */
interface CustomHostnameIndex {
  findId(hostnameFqdn: string): string | undefined
}

const hostnamesPath = (zoneId: string, hostnameId?: string) =>
  `zones/${encodeURIComponent(zoneId)}/custom_hostnames${hostnameId ? `/${encodeURIComponent(hostnameId)}` : ''}`

/** Cloudflare for SaaS 自定义主机名 API */
export class SaaSCustomHostnameClient {
  constructor(private readonly access: CloudflareAccess) {}

  async listAll(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<CloudflareCustomHostname[]> {
    return collectNumberedPages(
      (page, perPage) => this.page(cloudflareProviderId, zoneId, page, perPage, refresh),
      CLOUDFLARE_PAGE_LIMIT
    )
  }

  async show(
    cloudflareProviderId: string,
    zoneId: string,
    hostnameId: string,
    refresh = false
  ): Promise<CloudflareCustomHostname> {
    const cached = await withProviderCache<CloudflareCustomHostname>({
      key: `${CLOUDFLARE_PROVIDER_TYPE}:custom_hostname:${cloudflareProviderId}:${zoneId}:${hostnameId}`,
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

  /**
   * 站点主机名索引快照：一次分页拉取 → 任意次按 FQDN 匹配。
   * 把「取列表」与「按 FQDN 找」拆开，是为了让「这次未命中要不要再打一遍上游」由调用形态决定：
   * 单站点写路径可以接受一次刷新确认，遍历全部站点的批量查找不能——那会放大成每站点一次全量重拉。
   */
  async hostnameIndex(cloudflareProviderId: string, zoneId: string, refresh = false): Promise<CustomHostnameIndex> {
    return new HostnameIndex(await this.listAll(cloudflareProviderId, zoneId, refresh))
  }

  /**
   * 单次查找（单站点用）：快照未命中时用一次强制刷新确认「上游确实没有」。
   * 这次刷新不能省：列表缓存只是某次拉取的快照，主机名可能在缓存写入之后才出现
   * （控制台手工创建、其它实例写入、失效标签没打到），只看缓存会把刚创建的主机名误判成 404。
   */
  async idByHostname(
    cloudflareProviderId: string,
    zoneId: string,
    hostnameFqdn: string,
    refresh = false
  ): Promise<string> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    const snapshot = await this.hostnameIndex(cloudflareProviderId, zoneId, refresh)
    const found =
      snapshot.findId(fqdn) ??
      (refresh ? undefined : (await this.hostnameIndex(cloudflareProviderId, zoneId, true)).findId(fqdn))
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
      key: `${CLOUDFLARE_PROVIDER_TYPE}:custom_hostnames:${cloudflareProviderId}:${zoneId}:${page}:${perPage}`,
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

  private async call<T>(
    cloudflareProviderId: string,
    action: SaasHostnameAction,
    details: Record<string, unknown>,
    fn: (client: CloudflareClient) => Promise<T>
  ): Promise<T> {
    const { client } = await this.access.forProvider(cloudflareProviderId)
    return callProvider(
      {
        code: SAAS_HOSTNAME_ACTION_ERROR_CODES[action],
        message: `Cloudflare custom hostname ${action} failed`,
        providerId: cloudflareProviderId,
        details,
      },
      () => fn(client)
    )
  }
}

/**
 * 索引实现：构建期做完归一化与去重，匹配期只做一次哈希查表。
 * 同一 FQDN 有多条时保留首个，与旧的「逐页查找、首个命中即返回」结果一致。
 */
class HostnameIndex implements CustomHostnameIndex {
  private readonly byFqdn: ReadonlyMap<string, string>

  constructor(hostnames: readonly CloudflareCustomHostname[]) {
    const byFqdn = new Map<string, string>()
    for (const hostname of hostnames) {
      const fqdn = normalizeFqdn(hostname.hostname)
      if (hostname.id === '' || fqdn === '' || byFqdn.has(fqdn)) continue
      byFqdn.set(fqdn, hostname.id)
    }
    this.byFqdn = byFqdn
  }

  findId(hostnameFqdn: string): string | undefined {
    return this.byFqdn.get(normalizeFqdn(hostnameFqdn))
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
    custom_metadata: asRecordOrNull(parsed.custom_metadata),
  }
}
