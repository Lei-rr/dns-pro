/**
 * SaaS 同步目标解析（§4.2 planner 的目标侧）。
 *
 * DNSPod 与 Cloudflare DNS 两条目标的解析规则集中在此：预检/同步/清理等写入路径与
 * 对账扫描共用同一判据。对外仍经 saas.planner 再导出，调用方不感知。
 */
import { ApiError } from '../../../core/http/api-error.js'
import type { ProviderRepository } from '../../../core/providers/provider.repository.js'
import { normalizeFqdn } from '../../../shared/values.js'
import type { DnsPodAccess } from '../../../modules/dnspod/access.js'
import type { DnsPodZoneCatalog } from '../../../modules/dnspod/zone-catalog.js'
import type { CloudflareZoneService } from '../../../modules/cloudflare/cloudflare-zone.service.js'
import type { CloudflareCustomHostname } from '../../../modules/cloudflare/saas/saas-custom-hostname.client.js'
import { zoneOwnsHostname } from '../../../modules/cloudflare/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../../modules/cloudflare/saas/saas-hostname.service.js'
import type { SaaSSyncConfigService } from '../../../modules/cloudflare/saas/saas-sync-config.service.js'
import type { SaaSSyncProviderType } from './saas-records.js'

export interface SaaSDnsTarget {
  providerType: SaaSSyncProviderType
  providerId: string
  zone: string
}

/** DNSPod 目标解析依赖（DNSPod 写入适配器注入自身字段即可） */
export interface SaaSDnsPodTargetDeps {
  hostnames: SaaSHostnameService
  access: DnsPodAccess
  catalog: DnsPodZoneCatalog
}

/** Cloudflare DNS 目标解析依赖 */
export interface SaaSSyncTargetDeps {
  hostnames: SaaSHostnameService
  syncConfigs: SaaSSyncConfigService
  cloudflareZones: CloudflareZoneService
}

/** 对账 planner 依赖：两条目标解析路径 + 服务商仓库 */
export type SaaSDerivedPlannerDeps = SaaSDnsPodTargetDeps & SaaSSyncTargetDeps & { providers: ProviderRepository }

/** 业务回源：主机名自定义回源优先，否则站点默认回源 */
export async function resolveEffectiveOrigin(
  hostnames: SaaSHostnameService,
  providerId: string,
  cfZoneName: string,
  hostname: CloudflareCustomHostname
): Promise<string> {
  const custom = String(hostname.custom_origin_server ?? '').trim()
  return custom || ((await hostnames.fallbackOrigin(providerId, cfZoneName)) ?? '')
}

/** 主机名声明的 DNSPod 关联服务商（主机名级优先，其次 SaaS 关联） */
export async function saasDnsPodProviderId(
  deps: SaaSDnsPodTargetDeps,
  providerId: string,
  hostname: CloudflareCustomHostname
): Promise<string> {
  return String(hostname.sync_provider_id ?? '').trim() || deps.access.linkedProviderId(providerId, 'saas', 'SaaS')
}

/** SaaS 服务商默认的 Cloudflare DNS 服务商 */
export async function saasDefaultCloudflareProviderId(deps: SaaSSyncTargetDeps, providerId: string): Promise<string> {
  const id = await deps.syncConfigs.defaultSyncProviderId(providerId, 'cloudflare_dns')
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
  hostname: CloudflareCustomHostname | null,
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
  const zone = explicitZone.trim() || (await deps.hostnames.syncConfig(providerId, fqdn)).sync_zone
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
  hostname: CloudflareCustomHostname,
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
  let zoneName = (explicit.zone?.trim() || sync?.sync_zone || '').toLowerCase()
  if (zoneName !== '' && !zoneOwnsHostname(zoneName, hostnameFqdn)) zoneName = ''
  zoneName ||= normalizeFqdn(cfZoneName)
  if (zoneName === '') {
    throw new ApiError('saas_cloudflare_sync_zone_missing', 'Cloudflare DNS sync zone is required', 422)
  }
  const fqdn = normalizeFqdn(hostnameFqdn)
  if (!zoneOwnsHostname(zoneName, fqdn)) {
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

/** 按主机名生效配置解析写入目标（对账与写入共用） */
export async function resolveSaaSSyncTarget(
  deps: SaaSDnsPodTargetDeps & SaaSSyncTargetDeps,
  providerId: string,
  hostname: CloudflareCustomHostname,
  fqdn: string,
  cfZoneName: string
): Promise<SaaSDnsTarget> {
  const config = await deps.hostnames.effectiveSyncConfig(providerId, fqdn, cfZoneName)
  if (config.sync_target === 'cloudflare_dns') {
    const target = await resolveCloudflareSaasTarget(deps, providerId, fqdn, {
      zone: config.sync_zone,
      provider: config.sync_provider_id,
      cfZoneName,
    })
    return { providerType: 'cloudflare', providerId: target.providerId, zone: target.zone }
  }
  return resolveDnsPodSaasTarget(deps, providerId, hostname, fqdn, config.sync_zone)
}
