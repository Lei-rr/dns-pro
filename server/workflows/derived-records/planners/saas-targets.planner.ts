/**
 * SaaS 同步目标解析（§4.2 planner 的目标侧）。
 *
 * DNSPod 与 Cloudflare DNS 两条目标的解析规则集中在此：预检/同步/清理等写入路径与
 * repair 共用同一判据。对外仍经 saas.planner 再导出，调用方不感知。
 */
import { ApiError } from '../../../core/http/api-error.js'
import type { CloudflareZonePort } from '../../../core/contracts/cloudflare-zone.port.js'
import type { DnsZoneCatalogPort } from '../../../core/contracts/dns-zone-catalog.port.js'
import type { LinkedDnsAccountPort } from '../../../core/contracts/linked-dns-account.port.js'
import type { SaaSHostnameRulesPort } from '../../../core/contracts/saas-hostname-rules.port.js'
import type { SaaSHostnamePort, SaaSHostnameValue } from '../../../core/contracts/saas-hostname.port.js'
import type { SaaSSyncConfigPort, SaaSSyncDefaultsPort } from '../../../core/contracts/saas-sync-config.port.js'
import { unsupportedSyncTarget } from '../../../core/contracts/saas-sync-config.port.js'
import type { ProviderRepository } from '../../../core/providers/provider.repository.js'
import { normalizeFqdn } from '../../../shared/values.js'
import type { SaaSSyncProviderType } from './saas-records.planner.js'

export interface SaaSDnsTarget {
  providerType: SaaSSyncProviderType
  providerId: string
  zone: string
}

/**
 * 主机名侧端口族：目标解析与期望记录构造都要读主机名、解析同步配置并判定状态，
 * 由同一实例（SaaSHostnameService）实现，装配时一次注入。
 */
export type SaaSPlannerHostnames = SaaSHostnamePort & SaaSSyncConfigPort & SaaSHostnameRulesPort

/** DNSPod 目标解析依赖（DNSPod 写入适配器注入自身字段即可；底座能力只经端口） */
export interface SaaSDnsPodTargetDeps {
  hostnames: SaaSPlannerHostnames
  access: LinkedDnsAccountPort
  catalog: DnsZoneCatalogPort
}

/** Cloudflare DNS 目标解析依赖 */
export interface SaaSSyncTargetDeps {
  hostnames: SaaSPlannerHostnames
  /** 服务商默认同步目标：只看服务商关联字段，不读主机名偏好 */
  syncDefaults: SaaSSyncDefaultsPort
  cloudflareZones: CloudflareZonePort
}

/** 目标解析的完整依赖：两条解析路径 + 服务商仓库 */
export type SaaSPlannerDeps = SaaSDnsPodTargetDeps & SaaSSyncTargetDeps & { providers: ProviderRepository }

/** 业务回源：主机名自定义回源优先，否则站点默认回源 */
export async function resolveEffectiveOrigin(
  hostnames: SaaSHostnamePort,
  providerId: string,
  cfZoneName: string,
  hostname: SaaSHostnameValue
): Promise<string> {
  const custom = String(hostname.custom_origin_server ?? '').trim()
  return custom || ((await hostnames.fallbackOrigin(providerId, cfZoneName)) ?? '')
}

/** 主机名声明的 DNSPod 关联服务商（主机名级优先，其次 SaaS 关联） */
export async function saasDnsPodProviderId(
  deps: SaaSDnsPodTargetDeps,
  providerId: string,
  hostname: SaaSHostnameValue
): Promise<string> {
  return String(hostname.sync_provider_id ?? '').trim() || deps.access.linkedProviderId(providerId, 'saas', 'SaaS')
}

/** SaaS 服务商默认的 Cloudflare DNS 服务商 */
export async function saasDefaultCloudflareProviderId(deps: SaaSSyncTargetDeps, providerId: string): Promise<string> {
  const id = await deps.syncDefaults.defaultSyncProviderId(providerId, 'cloudflare_dns')
  if (id === '') {
    throw new ApiError(
      'saas_cloudflare_dns_provider_missing',
      'SaaS provider is not linked to a Cloudflare DNS provider',
      422
    )
  }
  return id
}

/**
 * DNSPod 同步目标：显式同步站点优先，否则按最长后缀匹配。
 * 显式值可能来自旧版猜测或账号变更（例如 example.co.uk），此时回退到权威匹配，避免整段同步被跳过。
 * hostname 为 null 表示主机名尚未创建（创建前预检）。
 */
export async function resolveDnsPodSaasTarget(
  deps: SaaSDnsPodTargetDeps,
  providerId: string,
  hostname: SaaSHostnameValue | null,
  fqdn: string,
  explicitZone = '',
  explicitProvider = ''
): Promise<SaaSDnsTarget> {
  const dnspodProviderId =
    explicitProvider.trim() ||
    (hostname
      ? await saasDnsPodProviderId(deps, providerId, hostname)
      : await deps.access.linkedProviderId(providerId, 'saas', 'SaaS'))
  if (dnspodProviderId === '') {
    throw new ApiError('saas_dnspod_provider_missing', 'SaaS provider is not linked to a DNSPod provider', 422)
  }
  // 两个来源都要归一：sync_zone 是用户在前端配置的，带首尾空格时仍是 truthy，
  // 会绕过下面的「空则退回后缀匹配」判定，拿一个带空格的站点名去 requireExplicit。
  // 短路语义必须保留——显式站点已给出时不去读主机名同步配置。
  const explicitZoneValue = explicitZone.trim()
  const configuredZone = explicitZoneValue ? '' : (await deps.hostnames.syncConfig(providerId, fqdn)).sync_zone.trim()
  const zone = explicitZoneValue || configuredZone
  if (zone) {
    try {
      return {
        providerType: 'dnspod',
        providerId: dnspodProviderId,
        zone: await deps.catalog.requireExplicit(dnspodProviderId, zone, 'saas'),
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'saas_dnspod_zone_not_found')) throw error
      // 显式站点在账号中不存在：改用最长后缀匹配
    }
  }
  return {
    providerType: 'dnspod',
    providerId: dnspodProviderId,
    zone: await deps.catalog.resolve(dnspodProviderId, fqdn, 'saas'),
  }
}

/** 解析失败（未关联服务商 / 找不到域名）用 ok:false 显式标记，不与成功的写入目标混用同一形状 */
export type DnsPodSaasTargetResolution = (SaaSDnsTarget & { ok: true }) | { ok: false; reason: string }

/** 目标解析：失败返回跳过原因，不抛出 */
export async function optionalDnsPodSaasTarget(
  deps: SaaSDnsPodTargetDeps,
  providerId: string,
  hostname: SaaSHostnameValue,
  fqdn: string
): Promise<DnsPodSaasTargetResolution> {
  if ((await saasDnsPodProviderId(deps, providerId, hostname)) === '') {
    return { ok: false, reason: 'dnspod_provider_missing' }
  }
  try {
    return { ...(await resolveDnsPodSaasTarget(deps, providerId, hostname, fqdn)), ok: true }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'saas_dnspod_zone_not_found') {
      return { ok: false, reason: 'dnspod_zone_not_found' }
    }
    throw error
  }
}

export interface CloudflareSaasTarget {
  providerType: 'cloudflare'
  providerId: string
  zoneId: string
  zone: string
}

/**
 * Cloudflare DNS 同步目标：显式同步站点优先，未配置时回退到主机名所在站点。
 * 同步站点必须拥有该主机名，防止把 api.example.com 写进无关站点。
 */
export async function resolveCloudflareSaasTarget(
  deps: SaaSSyncTargetDeps,
  providerId: string,
  hostnameFqdn: string,
  explicit: { zone?: string; provider?: string; skipHostnameConfig?: boolean; cfZoneName?: string } = {}
): Promise<CloudflareSaasTarget> {
  const cfZoneName = explicit.cfZoneName ?? ''
  const sync = explicit.skipHostnameConfig ? null : await deps.hostnames.syncConfig(providerId, hostnameFqdn)
  const cloudflareProviderId =
    explicit.provider?.trim() || sync?.sync_provider_id || (await saasDefaultCloudflareProviderId(deps, providerId))
  // 两个来源都归一：zoneOwnsHostname 内部会 normalizeFqdn，所以归属判定本身不会错，
  // 但 zoneName 还要作为返回值传出去写进解析记录，带空格会一路传播
  let zoneName = (explicit.zone?.trim() || sync?.sync_zone?.trim() || '').toLowerCase()
  if (zoneName !== '' && !deps.hostnames.zoneOwnsHostname({ zone: zoneName, fqdn: hostnameFqdn })) zoneName = ''
  zoneName ||= normalizeFqdn(cfZoneName)
  if (zoneName === '') {
    throw new ApiError('saas_cloudflare_sync_zone_missing', 'Cloudflare DNS sync zone is required', 422)
  }
  const fqdn = normalizeFqdn(hostnameFqdn)
  if (!deps.hostnames.zoneOwnsHostname({ zone: zoneName, fqdn })) {
    throw new ApiError(
      'saas_cloudflare_sync_zone_mismatch',
      `Cloudflare DNS sync zone ${zoneName} does not match hostname ${fqdn}`,
      422,
      { hostname: fqdn, sync_zone: zoneName }
    )
  }
  return {
    providerType: 'cloudflare',
    providerId: cloudflareProviderId,
    zoneId: await deps.cloudflareZones.idByName(cloudflareProviderId, zoneName),
    zone: zoneName,
  }
}

/** 按主机名生效配置解析写入目标（写入与 repair 共用） */
export async function resolveSaaSSyncTarget(
  deps: SaaSDnsPodTargetDeps & SaaSSyncTargetDeps,
  providerId: string,
  hostname: SaaSHostnameValue,
  fqdn: string,
  cfZoneName: string
): Promise<SaaSDnsTarget> {
  const config = await deps.hostnames.effectiveSyncConfig(providerId, fqdn, cfZoneName)
  switch (config.sync_target) {
    case 'cloudflare_dns': {
      const target = await resolveCloudflareSaasTarget(deps, providerId, fqdn, {
        zone: config.sync_zone,
        provider: config.sync_provider_id,
        cfZoneName,
      })
      return { providerType: 'cloudflare', providerId: target.providerId, zone: target.zone }
    }
    case 'dnspod':
    case '':
      // 空目标＝未配置：与写入路径一致地走 DNSPod（未关联时由 resolveDnsPodSaasTarget 显式失败）
      return resolveDnsPodSaasTarget(deps, providerId, hostname, fqdn, config.sync_zone)
    default:
      return unsupportedSyncTarget(config.sync_target)
  }
}
