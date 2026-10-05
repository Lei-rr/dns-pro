import type { CloudflareZoneService, ZoneListResult } from '../cloudflare-zone.service.js'
import type { ZoneCatalog } from '../zone-catalog.js'
import { ApiError } from '../../../core/http/api-error.js'
import { errorMessage, normalizeFqdn } from '../../../shared/values.js'
import { isExplicitNotFound } from '../../../core/providers/provider-error.js'
import { toFullListResult } from '../../../core/providers/provider-call.js'
import type { SaaSHostnameCachePort } from '../../../core/contracts/saas-hostname-cache.port.js'
import type { SaaSHostnamePort } from '../../../core/contracts/saas-hostname.port.js'
import type { SaaSHostnameRulesPort } from '../../../core/contracts/saas-hostname-rules.port.js'
import type { SaaSSyncConfigPort } from '../../../core/contracts/saas-sync-config.port.js'
import type { PreferredDomainService } from './preferred-domain.service.js'
import type { SaaSCustomHostnameClient, CloudflareCustomHostname } from './saas-custom-hostname.client.js'
import type { FallbackOriginInfo, SaaSFallbackOriginClient } from './saas-fallback-origin.client.js'
import {
  effectivePreferredDomain,
  isHostnameActive,
  tryNormalizeFallbackOrigin,
  zoneOwnsHostname,
} from './saas-hostname-rules.js'
import { invalidateSaaSHostnameCache, invalidateSaaSHostnameDetailsCache } from './saas.cache.js'
import { preferenceOf } from './saas-preference.service.js'
import type { HostnameIdentity, SaaSPreferenceService } from './saas-preference.service.js'
import type { MergedHostname, SaaSSyncConfigService } from './saas-sync-config.service.js'

const SYNC_FIELDS = ['sync_target', 'sync_provider_id', 'sync_zone', 'auto_preferred'] as const
const NOT_FOUND = { localCodes: ['saas_hostname_not_found'] }

type HostnameRef = { cloudflareProviderId: string; zoneId: string; zoneName: string; hostnameId: string }

/**
 * Cloudflare for SaaS 自定义主机名编排：远端 CRUD + 本地偏好合并。
 * DNS 同步配置解析见 SaaSSyncConfigService。
 * 编排依赖的四个端口（读写 / 同步配置 / 判定规则 / 缓存失效）由本类实现，方法委派模块内既有实现。
 */
export class SaaSHostnameService
  implements SaaSHostnamePort, SaaSSyncConfigPort, SaaSHostnameRulesPort, SaaSHostnameCachePort
{
  constructor(
    private readonly cloudflareZones: CloudflareZoneService,
    private readonly zoneCatalog: ZoneCatalog,
    private readonly customHostnames: SaaSCustomHostnameClient,
    private readonly fallbackOrigins: SaaSFallbackOriginClient,
    private readonly preferredDomains: PreferredDomainService,
    private readonly preferences: SaaSPreferenceService,
    private readonly syncConfigs: SaaSSyncConfigService
  ) {}

  async zones(providerId: string, refresh = false): Promise<ZoneListResult> {
    return this.cloudflareZones.listAll(await this.cloudflareProviderId(providerId), refresh)
  }

  /** SaaS 服务商 → 关联 Cloudflare 服务商 ID */
  cloudflareProviderId(providerId: string): Promise<string> {
    return this.syncConfigs.cloudflareProviderId(providerId)
  }

  /** 站点名 → Cloudflare 服务商 + 站点 ID（用于缓存标签） */
  async resolveZoneRef(providerId: string, zoneName: string) {
    const cloudflareProviderId = await this.cloudflareProviderId(providerId)
    const zoneId = await this.cloudflareZones.idByName(cloudflareProviderId, zoneName)
    return { cloudflareProviderId, zoneId }
  }

  async hostnames(providerId: string, zoneName: string, refresh = false) {
    const { cloudflareProviderId, zoneId } = await this.resolveZoneRef(providerId, zoneName)
    const [list, preferenceMap] = await Promise.all([
      this.customHostnames.listAll(cloudflareProviderId, zoneId, refresh),
      this.preferences.listByProvider(cloudflareProviderId),
    ])
    const items = await Promise.all(
      list.map((hostname) =>
        this.applyEffectiveSyncConfig(
          providerId,
          this.syncConfigs.mergePreference(
            hostname,
            preferenceOf(preferenceMap, { zone: zoneName, fqdn: String(hostname.hostname ?? '') })
          )
        )
      )
    )
    const { pagination } = toFullListResult(items)
    return { items, pagination }
  }

  async showHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    refresh = false
  ): Promise<CloudflareCustomHostname> {
    const ref = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    try {
      return await this.loadDetailed(providerId, ref, refresh)
    } catch (error) {
      // 主机名 ID 缓存过期（被删除重建）时刷新 ID 再查一次
      if (!isExplicitNotFound(error, NOT_FOUND)) throw error
      const hostnameId = await this.customHostnames.idByHostname(
        ref.cloudflareProviderId,
        ref.zoneId,
        hostnameFqdn,
        true
      )
      return this.loadDetailed(providerId, { ...ref, hostnameId }, refresh)
    }
  }

  async createHostname(
    providerId: string,
    zoneName: string,
    data: Record<string, unknown>
  ): Promise<CloudflareCustomHostname> {
    const { cloudflareProviderId: cfId, zoneId } = await this.resolveZoneRef(providerId, zoneName)
    const preferred = await this.validatedPreferredDomain(data)
    const normalizedSync = SYNC_FIELDS.some((field) => field in data)
      ? await this.syncConfigs.normalizeSyncPreference(providerId, String(data.hostname ?? ''), null, data)
      : null
    // 远端创建前校验同步服务商引用，避免创建后才失败
    if (normalizedSync !== null) await this.preferences.validateSyncConfig(cfId, normalizedSync)

    const hostname = await this.customHostnames.create(cfId, zoneId, data)
    if (hostname.id === '') return hostname

    // 远端已创建：本地偏好失败不回滚，作为 local_preference_error 返回
    const identity = { zone: zoneName, fqdn: hostname.hostname }
    try {
      if (preferred !== null) await this.preferences.setPreferredDomain(cfId, identity, preferred, hostname.id)
      if (normalizedSync !== null) {
        await this.preferences.setNormalizedSyncConfig(cfId, identity, normalizedSync, hostname.id)
      }
      await this.preferences.markOwnershipTxtCleaned(cfId, hostname.id, false, hostname.hostname)
      return await this.applyEffectiveSyncConfig(providerId, await this.withPreference(hostname, cfId, identity))
    } catch (error) {
      return { ...hostname, local_preference_error: errorMessage(error) }
    }
  }

  async updateHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    data: Record<string, unknown>,
    options: { remoteApplied?: boolean } = {}
  ): Promise<CloudflareCustomHostname> {
    const {
      cloudflareProviderId: cfId,
      zoneId,
      hostnameId,
    } = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    const preferred = await this.validatedPreferredDomain(data)
    // PATCH 与否由上游当前状态决定，必须新鲜读取：缓存快照可能已过期（TTL 5 分钟），
    // 命中旧值会整段跳过 PATCH 并把缓存值当成功返回
    const current = await this.customHostnames.show(cfId, zoneId, hostnameId, true)
    const remotePatch = this.syncConfigs.buildCloudflareUpdatePayload(current, data)
    const remoteChanged = Object.keys(remotePatch).length > 0

    const fqdn = current.hostname || hostnameFqdn
    const identity = { zone: zoneName, fqdn }
    const existing = await this.preferences.get(cfId, identity)

    // 校验前移：合并请求与已存偏好后先校验同步服务商引用，非法组合在写偏好与远端 PATCH 之前整体 422。
    // 否则会降级成「优选域名已提交、同步配置才 422」的部分失败：远端已变、本地只落了一半，且只回一个 200。
    const normalized =
      preferred !== null || SYNC_FIELDS.some((field) => field in data)
        ? await this.syncConfigs.normalizeSyncPreference(providerId, fqdn, existing, data)
        : null
    if (normalized !== null) await this.preferences.validateSyncConfig(cfId, normalized)

    // 批量重试时远端已应用，跳过重复 PATCH
    const hostname =
      remoteChanged && !options.remoteApplied
        ? await this.customHostnames.update(cfId, zoneId, hostnameId, remotePatch)
        : current

    try {
      // 优选域名与同步配置落在同一偏好行上，合并为一次事务写：分两次写会在中间失败时留下半截状态
      if (preferred !== null || normalized !== null) {
        await this.preferences.setPreferredAndSync({
          cloudflareProviderId: cfId,
          identity,
          hostnameId,
          preferredDomain: preferred,
          sync: normalized,
        })
      }
      // 远端字段变化后可能重新需要所有权验证
      if (remoteChanged) await this.preferences.markOwnershipTxtCleaned(cfId, hostnameId, false, fqdn)
      return await this.applyEffectiveSyncConfig(providerId, await this.withPreference(hostname, cfId, identity))
    } catch (error) {
      return { ...hostname, local_preference_error: errorMessage(error) }
    }
  }

  async deleteHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<{ id: string }> {
    let ref: HostnameRef
    try {
      ref = await this.resolveHostname(providerId, zoneName, hostnameFqdn)
    } catch (error) {
      if (!isExplicitNotFound(error, NOT_FOUND)) throw error
      // 站点不托管该 FQDN：这不是「远端已删除」，而是请求把别的站点的主机名带到了本站点。
      // 既不能清偏好（clearForFqdn 只按行内 hostname 匹配，会连另一站点同名 FQDN 的偏好一起删掉），
      // 也不能返回成功——批量任务会把它记成「已删除」，而那条主机名其实还在别的站点活着。
      if (!zoneOwnsHostname(zoneName, hostnameFqdn)) {
        throw new ApiError(
          'validation_failed',
          `SaaS hostname ${hostnameFqdn} does not belong to zone ${zoneName}`,
          422
        )
      }
      // 远端已不存在：只清本地偏好
      await this.syncConfigs.clearPreferencesForFqdn(await this.cloudflareProviderId(providerId), hostnameFqdn)
      return { id: '' }
    }

    try {
      await this.customHostnames.delete(ref.cloudflareProviderId, ref.zoneId, ref.hostnameId)
    } catch (error) {
      if (!isExplicitNotFound(error)) throw error
    }
    await this.preferences.clearForFqdn(ref.cloudflareProviderId, hostnameFqdn)
    return { id: ref.hostnameId }
  }

  async fallbackOriginInfo(providerId: string, zoneName: string, refresh = false): Promise<FallbackOriginInfo> {
    const { cloudflareProviderId, zoneId } = await this.resolveZoneRef(providerId, zoneName)
    return this.fallbackOrigins.show(cloudflareProviderId, zoneId, refresh)
  }

  async fallbackOrigin(providerId: string, zoneName: string): Promise<string | null> {
    return (await this.fallbackOriginInfo(providerId, zoneName)).origin
  }

  async setFallbackOrigin(providerId: string, zoneName: string, origin: string): Promise<FallbackOriginInfo> {
    const normalized = tryNormalizeFallbackOrigin(zoneName, origin)
    if (normalized == null) {
      throw new ApiError('fallback_origin_invalid', `Fallback origin must be a subdomain of ${zoneName}`, 422)
    }
    const { cloudflareProviderId, zoneId } = await this.resolveZoneRef(providerId, zoneName)
    return this.fallbackOrigins.set(cloudflareProviderId, zoneId, normalized)
  }

  async deleteFallbackOrigin(providerId: string, zoneName: string): Promise<FallbackOriginInfo> {
    const { cloudflareProviderId, zoneId } = await this.resolveZoneRef(providerId, zoneName)
    return this.fallbackOrigins.delete(cloudflareProviderId, zoneId)
  }

  /** 显式（本地保存的）同步配置；优先按 FQDN 匹配本地偏好，避免远端查询 */
  async syncConfig(providerId: string, hostnameFqdn: string, zoneName = '') {
    const cfId = await this.cloudflareProviderId(providerId)
    const byFqdn = await this.syncConfigs.preferenceForFqdn(cfId, hostnameFqdn, zoneName)
    if (byFqdn) return this.syncConfigs.presentExplicit(byFqdn)

    const ref =
      zoneName !== ''
        ? await this.resolveHostname(providerId, zoneName, hostnameFqdn)
        : await this.resolveHostnameByFqdn(providerId, hostnameFqdn)
    return this.syncConfigs.presentExplicit(
      await this.preferences.get(ref.cloudflareProviderId, { zone: ref.zoneName, fqdn: hostnameFqdn })
    )
  }

  /** 生效的同步配置（显式配置 + 服务商默认值 + 脏数据修复） */
  async effectiveSyncConfig(providerId: string, hostnameFqdn: string, zoneName = '') {
    const explicit = await this.syncConfig(providerId, hostnameFqdn, zoneName)
    return this.syncConfigs.effectiveSyncConfig(providerId, hostnameFqdn, explicit)
  }

  defaultSyncTarget(providerId: string): Promise<string> {
    return this.syncConfigs.defaultSyncTarget(providerId)
  }

  /** 端口 SaaSHostnameRulesPort：生效优选域名（读接口 / DNS 写回 / 一键切换共用同一取值顺序） */
  effectivePreferredDomain(
    hostname: { preferred_domain?: unknown; custom_metadata?: unknown },
    preference?: { preferred_domain?: unknown } | null
  ): string {
    return effectivePreferredDomain(hostname, preference)
  }

  /** 端口 SaaSHostnameRulesPort：在管状态判定（moved 已迁出，不算在管） */
  isHostnameActive(hostname: { status?: unknown }): boolean {
    return isHostnameActive(hostname)
  }

  /** 端口 SaaSHostnameRulesPort：站点归属判定（同名或为其子域） */
  zoneOwnsHostname(zone: string, fqdn: string): boolean {
    return zoneOwnsHostname(zone, fqdn)
  }

  /** 端口 SaaSHostnameCachePort：按站点身份失效；includeList=false 只失效详情（批量逐条用） */
  invalidateHostnameCache(cloudflareProviderId: string, zoneId: string, includeList: boolean): void {
    if (includeList) invalidateSaaSHostnameCache(cloudflareProviderId, zoneId, true)
    else invalidateSaaSHostnameDetailsCache(cloudflareProviderId, zoneId)
  }

  /** 端口 SaaSHostnameCachePort：按 SaaS 服务商 + 站点名解析站点后失效 */
  async invalidateZoneCache(providerId: string, zoneName: string, includeList: boolean): Promise<void> {
    const zone = await this.resolveZoneRef(providerId, zoneName)
    this.invalidateHostnameCache(zone.cloudflareProviderId, zone.zoneId, includeList)
  }

  /** 解析主机名 ID：列表走缓存（变更由标签精确失效），详情刷新由调用方决定 */
  private async resolveHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<HostnameRef> {
    const { cloudflareProviderId, zoneId } = await this.resolveZoneRef(providerId, zoneName)
    const hostnameId = await this.customHostnames.idByHostname(cloudflareProviderId, zoneId, hostnameFqdn)
    return { cloudflareProviderId, zoneId, zoneName, hostnameId }
  }

  /** 未知站点时遍历所有站点查找主机名 */
  private async resolveHostnameByFqdn(providerId: string, hostnameFqdn: string): Promise<HostnameRef> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    const cloudflareProviderId = await this.cloudflareProviderId(providerId)
    for (const zone of (await this.cloudflareZones.listAll(cloudflareProviderId)).items) {
      if (!zone.id || !zone.name) continue
      try {
        // 站点 ID 已在手：直接查主机名，省掉 idByName（带 name 过滤、与 listAll 不同键）对每个站点的一次上游往返
        const hostnameId = await this.customHostnames.idByHostname(cloudflareProviderId, zone.id, fqdn)
        return { cloudflareProviderId, zoneId: zone.id, zoneName: zone.name, hostnameId }
      } catch (error) {
        if (!isExplicitNotFound(error, NOT_FOUND)) throw error
      }
    }
    throw new ApiError('saas_hostname_not_found', `SaaS hostname ${hostnameFqdn} not found`, 404)
  }

  /**
   * 优选域名白名单校验：一键切换（预览/创建）与单条更新共用同一判定，非法时 422。
   * 返回归一化后的域名：该值会落库并作为 DNS 目标（'https://x.com' 这类等价写法不能原样带下去）。
   */
  async ensurePreferredDomainAllowed(value: string): Promise<string> {
    const preferred = String(value ?? '').trim()
    if (preferred === '') return ''
    const normalized = this.preferredDomains.normalize(preferred)
    if (normalized === null || !(await this.preferredDomains.isAllowed(normalized))) {
      throw new ApiError('preferred_domain_not_allowed', `Preferred domain ${preferred} is not allowed`, 422)
    }
    return normalized
  }

  /** 校验优选域名在白名单内；未提交该字段返回 null，空串表示清除 */
  private async validatedPreferredDomain(data: Record<string, unknown>): Promise<string | null> {
    if (!('preferred_domain' in data)) return null
    return await this.ensurePreferredDomainAllowed(String(data.preferred_domain ?? ''))
  }

  private async withPreference(
    hostname: CloudflareCustomHostname,
    cfId: string,
    identity: HostnameIdentity
  ): Promise<MergedHostname> {
    return this.syncConfigs.mergePreference(
      hostname,
      identity.fqdn === '' ? null : await this.preferences.get(cfId, identity)
    )
  }

  private async loadDetailed(
    providerId: string,
    ref: HostnameRef,
    refresh: boolean
  ): Promise<CloudflareCustomHostname> {
    const hostname = await this.customHostnames.show(ref.cloudflareProviderId, ref.zoneId, ref.hostnameId, refresh)
    const ssl = hostname.ssl ?? {}
    // 主机名未返回 DCV UUID 时用站点级 UUID 兜底；站点级查询失败（非 SaaS 站点 403/404）不阻断详情
    const dcvUuid =
      String(ssl.dcv_delegation_uuid ?? '') ||
      (await this.zoneCatalog.dcvDelegationUuid(ref.cloudflareProviderId, ref.zoneId).catch(() => ''))
    const enriched = { ...hostname, ssl: { ...ssl, dcv_delegation_uuid: dcvUuid } }
    return this.applyEffectiveSyncConfig(
      providerId,
      await this.withPreference(enriched, ref.cloudflareProviderId, {
        zone: ref.zoneName,
        fqdn: String(hostname.hostname ?? ''),
      })
    )
  }

  /** 读/写两条路径共用的收尾：补齐生效同步配置的派生字段，保证响应形状一致 */
  private async applyEffectiveSyncConfig(
    providerId: string,
    hostname: MergedHostname
  ): Promise<CloudflareCustomHostname> {
    // 列表页用已合并的偏好直接计算，避免逐条再查远端
    const effective = await this.syncConfigs.effectiveSyncConfig(
      providerId,
      hostname.hostname,
      this.syncConfigs.presentExplicit(hostname)
    )
    return {
      ...hostname,
      effective_sync_target: effective.sync_target,
      effective_sync_provider_id: effective.sync_provider_id,
      effective_sync_zone: effective.sync_zone,
      sync_config_explicit: effective.explicit,
    }
  }
}
