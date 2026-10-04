import type { CloudflareZoneService, ZoneListResult } from '../cloudflare/cloudflare-zone.service.js'
import { ApiError } from '../../shared/http/api-error.js'
import { errorMessage, normalizeFqdn } from '../../shared/lib/values.js'
import { isExplicitNotFound } from '../../shared/providers/provider-error.js'
import { toFullListResult } from '../../shared/providers/provider-call.js'
import type { PreferredDomainService } from './preferred-domain.service.js'
import type { SaaSCustomHostnameClient, CloudflareCustomHostname } from './saas-custom-hostname.client.js'
import type { FallbackOriginInfo, SaaSFallbackOriginClient } from './saas-fallback-origin.client.js'
import { tryNormalizeFallbackOrigin } from './saas-hostname-rules.js'
import type { HostnamePreference, SaaSPreferenceService } from './saas-preference.service.js'
import type { SaaSSyncConfigService } from './saas-sync-config.service.js'

const SYNC_FIELDS = ['sync_target', 'sync_provider_id', 'sync_zone', 'auto_preferred'] as const
const NOT_FOUND = { localCodes: ['saas_hostname_not_found'] }

type HostnameRef = { cloudflareProviderId: string; zoneId: string; hostnameId: string }

/**
 * Cloudflare for SaaS 自定义主机名编排：远端 CRUD + 本地偏好合并。
 * DNS 同步配置解析见 SaaSSyncConfigService。
 */
export class SaaSHostnameService {
  constructor(
    private readonly cloudflareZones: CloudflareZoneService,
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
          this.syncConfigs.mergePreference(hostname, preferenceMap[hostname.id] ?? null)
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
    try {
      if (preferred !== null) await this.preferences.setPreferredDomain(cfId, hostname.id, preferred)
      if (normalizedSync !== null) {
        await this.preferences.setNormalizedSyncConfig(cfId, hostname.id, normalizedSync, hostname.hostname)
      }
      await this.preferences.markOwnershipTxtCleaned(cfId, hostname.id, false, hostname.hostname)
      return this.withPreference(hostname, cfId, hostname.id)
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
    const existing = await this.preferences.get(cfId, hostnameId)
    const current = await this.customHostnames.show(cfId, zoneId, hostnameId)
    const remotePatch = this.syncConfigs.buildCloudflareUpdatePayload(current, data)
    const remoteChanged = Object.keys(remotePatch).length > 0

    // 批量重试时远端已应用，跳过重复 PATCH
    const hostname =
      remoteChanged && !options.remoteApplied
        ? await this.customHostnames.update(cfId, zoneId, hostnameId, remotePatch)
        : current
    const fqdn = hostname.hostname || hostnameFqdn

    try {
      if (preferred !== null) await this.preferences.setPreferredDomain(cfId, hostnameId, preferred)
      if (preferred !== null || SYNC_FIELDS.some((field) => field in data)) {
        const normalized = await this.syncConfigs.normalizeSyncPreference(providerId, fqdn, existing, data)
        await this.preferences.setSyncConfig({
          cloudflareProviderId: cfId,
          hostnameId,
          syncTarget: normalized.sync_target,
          syncProviderId: normalized.sync_provider_id,
          syncZone: normalized.sync_zone,
          autoPreferred: normalized.auto_preferred,
          hostname: fqdn,
        })
      }
      // 远端字段变化后可能重新需要所有权验证
      if (remoteChanged) await this.preferences.markOwnershipTxtCleaned(cfId, hostnameId, false, fqdn)
      return this.withPreference(hostname, cfId, hostnameId)
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
      // 远端已不存在：只清本地偏好
      await this.syncConfigs.clearPreferencesForFqdn(await this.cloudflareProviderId(providerId), hostnameFqdn)
      return { id: '' }
    }

    try {
      await this.customHostnames.delete(ref.cloudflareProviderId, ref.zoneId, ref.hostnameId)
    } catch (error) {
      if (!isExplicitNotFound(error)) throw error
    }
    await this.preferences.clear(ref.cloudflareProviderId, ref.hostnameId)
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
    const byFqdn = await this.syncConfigs.preferenceForFqdn(cfId, hostnameFqdn)
    if (byFqdn) return this.syncConfigs.presentExplicit(byFqdn)

    const ref =
      zoneName !== ''
        ? await this.resolveHostname(providerId, zoneName, hostnameFqdn)
        : await this.resolveHostnameByFqdn(providerId, hostnameFqdn)
    return this.syncConfigs.presentExplicit(await this.preferences.get(ref.cloudflareProviderId, ref.hostnameId))
  }

  /** 生效的同步配置（显式配置 + 服务商默认值 + 脏数据修复） */
  async effectiveSyncConfig(providerId: string, hostnameFqdn: string, zoneName = '') {
    const explicit = await this.syncConfig(providerId, hostnameFqdn, zoneName)
    return this.syncConfigs.effectiveSyncConfig(providerId, hostnameFqdn, explicit)
  }

  defaultSyncTarget(providerId: string): Promise<string> {
    return this.syncConfigs.defaultSyncTarget(providerId)
  }

  /** 解析主机名 ID：列表走缓存（变更由标签精确失效），详情刷新由调用方决定 */
  private async resolveHostname(providerId: string, zoneName: string, hostnameFqdn: string): Promise<HostnameRef> {
    const { cloudflareProviderId, zoneId } = await this.resolveZoneRef(providerId, zoneName)
    const hostnameId = await this.customHostnames.idByHostname(cloudflareProviderId, zoneId, hostnameFqdn)
    return { cloudflareProviderId, zoneId, hostnameId }
  }

  /** 未知站点时遍历所有站点查找主机名 */
  private async resolveHostnameByFqdn(providerId: string, hostnameFqdn: string): Promise<HostnameRef> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    for (const zone of (await this.zones(providerId)).items) {
      if (!zone.name) continue
      try {
        return await this.resolveHostname(providerId, zone.name, fqdn)
      } catch (error) {
        if (!isExplicitNotFound(error, NOT_FOUND)) throw error
      }
    }
    throw new ApiError('saas_hostname_not_found', `SaaS hostname ${hostnameFqdn} not found`, 404)
  }

  /** 优选域名白名单校验：一键切换（预览/创建）与单条更新共用同一判定，非法时 422 */
  async ensurePreferredDomainAllowed(value: string): Promise<string> {
    const preferred = String(value ?? '').trim()
    if (preferred !== '' && !(await this.preferredDomains.isAllowed(preferred))) {
      throw new ApiError('preferred_domain_not_allowed', `Preferred domain ${preferred} is not allowed`, 422)
    }
    return preferred
  }

  /** 校验优选域名在白名单内；未提交该字段返回 null，空串表示清除 */
  private async validatedPreferredDomain(data: Record<string, unknown>): Promise<string | null> {
    if (!('preferred_domain' in data)) return null
    return await this.ensurePreferredDomainAllowed(String(data.preferred_domain ?? ''))
  }

  private async withPreference(hostname: CloudflareCustomHostname, cfId: string, hostnameId: string) {
    return this.syncConfigs.mergePreference(hostname, hostnameId ? await this.preferences.get(cfId, hostnameId) : null)
  }

  private async loadDetailed(
    providerId: string,
    ref: HostnameRef,
    refresh: boolean
  ): Promise<CloudflareCustomHostname> {
    const hostname = await this.customHostnames.show(ref.cloudflareProviderId, ref.zoneId, ref.hostnameId, refresh)
    const ssl = hostname.ssl ?? {}
    // 主机名未返回 DCV UUID 时用站点级 UUID 兜底
    const dcvUuid =
      String(ssl.dcv_delegation_uuid ?? '') ||
      (await this.cloudflareZones.dcvDelegationUuid(ref.cloudflareProviderId, ref.zoneId))
    const enriched = { ...hostname, ssl: { ...ssl, dcv_delegation_uuid: dcvUuid } }
    return this.applyEffectiveSyncConfig(
      providerId,
      await this.withPreference(enriched, ref.cloudflareProviderId, ref.hostnameId)
    )
  }

  private async applyEffectiveSyncConfig(
    providerId: string,
    hostname: CloudflareCustomHostname
  ): Promise<CloudflareCustomHostname> {
    // 列表页用已合并的偏好直接计算，避免逐条再查远端
    const effective = await this.syncConfigs.effectiveSyncConfig(
      providerId,
      hostname.hostname,
      this.syncConfigs.presentExplicit(hostname as unknown as Partial<HostnamePreference>)
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
