import type { ProviderRepository } from '../providers/provider.repository.js'
import type { SaaSProvider } from '../providers/provider.types.js'
import { ApiError } from '../../shared/http/api-error.js'
import { normalizeFqdn } from '../../shared/lib/values.js'
import type { CloudflareCustomHostname } from './saas-custom-hostname.client.js'
import { guessZoneFromFqdn, zoneOwnsHostname } from './saas-hostname-rules.js'
import type { HostnamePreference, SaaSPreferenceService, SyncPreference } from './saas-preference.service.js'

export type SyncTarget = 'dnspod' | 'cloudflare_dns' | ''

export type ExplicitSyncConfig = SyncPreference & { hostname: string }
type EffectiveSyncConfig = ExplicitSyncConfig & { explicit: boolean }

const text = (value: unknown) => String(value ?? '').trim()
const zoneText = (value: unknown) => text(value).toLowerCase()

/** SaaS DNS 同步配置解析与脏数据修复（与主机名 CRUD 解耦） */
export class SaaSSyncConfigService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly preferences: SaaSPreferenceService
  ) {}

  /** SaaS 服务商 → 关联 Cloudflare 服务商 ID */
  async cloudflareProviderId(saasProviderId: string): Promise<string> {
    const cfId = (await this.requireSaaS(saasProviderId)).cloudflare_provider.trim()
    if (cfId === '') {
      throw new ApiError(
        'saas_cloudflare_provider_missing',
        'SaaS provider is not linked to a Cloudflare provider',
        422
      )
    }
    return cfId
  }

  async preferenceForFqdn(cloudflareProviderId: string, hostnameFqdn: string): Promise<HostnamePreference | null> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    if (fqdn === '') return null
    const map = await this.preferences.listByProvider(cloudflareProviderId)
    return Object.values(map).find((pref) => normalizeFqdn(pref.hostname) === fqdn) ?? null
  }

  async clearPreferencesForFqdn(cloudflareProviderId: string, hostnameFqdn: string): Promise<number> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    if (fqdn === '') return 0
    const map = await this.preferences.listByProvider(cloudflareProviderId)
    const ids = Object.keys(map).filter((id) => normalizeFqdn(map[id]?.hostname) === fqdn)
    for (const id of ids) await this.preferences.clear(cloudflareProviderId, id)
    return ids.length
  }

  presentExplicit(preference: Partial<HostnamePreference> | null | undefined): ExplicitSyncConfig {
    return {
      hostname: text(preference?.hostname),
      sync_target: text(preference?.sync_target),
      sync_provider_id: text(preference?.sync_provider_id),
      sync_zone: zoneText(preference?.sync_zone),
      auto_preferred: Boolean(preference?.auto_preferred),
    }
  }

  /** 服务商默认同步目标：配置了 DNSPod 优先，否则 Cloudflare DNS */
  async defaultSyncTarget(saasProviderId: string): Promise<SyncTarget> {
    const provider = await this.requireSaaS(saasProviderId)
    if (text(provider.dnspod_provider)) return 'dnspod'
    if (text(provider.cloudflare_dns_provider) || text(provider.cloudflare_provider)) return 'cloudflare_dns'
    return ''
  }

  /** 目标对应的默认同步服务商 */
  async defaultSyncProviderId(saasProviderId: string, target: string): Promise<string> {
    const provider = await this.requireSaaS(saasProviderId)
    if (target === 'dnspod') return text(provider.dnspod_provider)
    if (target === 'cloudflare_dns') return text(provider.cloudflare_dns_provider) || text(provider.cloudflare_provider)
    return ''
  }

  /** 显式配置 + 默认值 → 生效配置；Cloudflare 目标站点不覆盖主机名时回退 */
  async effectiveSyncConfig(
    saasProviderId: string,
    hostnameFqdn: string,
    explicit: ExplicitSyncConfig
  ): Promise<EffectiveSyncConfig> {
    const resolved = await this.resolve(saasProviderId, hostnameFqdn, explicit, false)
    return {
      ...resolved,
      hostname: explicit.hostname,
      explicit: Boolean(explicit.sync_target || explicit.sync_provider_id || explicit.sync_zone),
    }
  }

  /** 合并请求字段与已有偏好，得到可保存的同步配置 */
  async normalizeSyncPreference(
    saasProviderId: string,
    hostnameFqdn: string,
    existing: HostnamePreference | null,
    data: Record<string, unknown>
  ): Promise<SyncPreference> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    // 显式提交空 target + 空 provider：表示关闭自动同步
    if (
      'sync_target' in data &&
      String(data.sync_target ?? '').trim() === '' &&
      String(data.sync_provider_id ?? '').trim() === ''
    ) {
      return {
        sync_target: '',
        sync_provider_id: '',
        sync_zone: '',
        auto_preferred: 'auto_preferred' in data ? Boolean(data.auto_preferred) : Boolean(existing?.auto_preferred),
      }
    }

    const stored: SyncPreference = {
      sync_target: text(existing?.sync_target),
      sync_provider_id: text(existing?.sync_provider_id),
      sync_zone: zoneText(existing?.sync_zone),
      auto_preferred: Boolean(existing?.auto_preferred),
    }
    let candidate: SyncPreference = {
      sync_target: text(data.sync_target) || stored.sync_target,
      sync_provider_id: text(data.sync_provider_id) || stored.sync_provider_id,
      sync_zone: zoneText(data.sync_zone) || stored.sync_zone,
      auto_preferred: 'auto_preferred' in data ? Boolean(data.auto_preferred) : stored.auto_preferred,
    }
    // 请求组合非法时先回退到已存配置，已存配置也非法则清空
    if (isMismatchedCloudflareZone(candidate, fqdn)) {
      candidate = isMismatchedCloudflareZone(stored, fqdn)
        ? { ...candidate, sync_target: '', sync_provider_id: '', sync_zone: '' }
        : { ...stored, auto_preferred: candidate.auto_preferred }
    }
    return this.resolve(saasProviderId, fqdn, candidate, true)
  }

  /** 合并 Cloudflare 主机名与本地偏好；本地偏好优先 */
  mergePreference(hostname: CloudflareCustomHostname, preference: HostnamePreference | null): CloudflareCustomHostname {
    const metadata = { ...(hostname.custom_metadata ?? {}) }
    const preferred =
      text(preference?.preferred_domain) || text(metadata.preferred_domain) || text(hostname.preferred_domain)
    if (preferred !== '') metadata.preferred_domain = preferred

    return {
      ...hostname,
      custom_metadata: Object.keys(metadata).length > 0 ? metadata : null,
      preferred_domain: preferred,
      sync_target: text(preference?.sync_target ?? hostname.sync_target),
      sync_provider_id: text(preference?.sync_provider_id ?? hostname.sync_provider_id),
      sync_zone: text(preference?.sync_zone ?? hostname.sync_zone),
      auto_preferred: preference ? preference.auto_preferred : Boolean(hostname.auto_preferred),
    }
  }

  /** 仅在 Cloudflare 托管字段实际变化时生成 PATCH 内容；优选/同步字段属于本地偏好 */
  buildCloudflareUpdatePayload(current: CloudflareCustomHostname, data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {}
    if (Object.hasOwn(data, 'custom_origin_server')) {
      const next = text(data.custom_origin_server)
      if (next !== text(current.custom_origin_server)) payload.custom_origin_server = next
    }
    const method = text(data.method)
    if (method !== '' && method !== text(current.ssl?.method)) payload.method = method
    const minTls = text(data.min_tls_version)
    if (minTls !== '' && minTls !== text(current.ssl?.settings?.min_tls_version)) payload.min_tls_version = minTls
    return payload
  }

  /**
   * 填充默认值并修复脏配置：Cloudflare 站点不覆盖主机名时，默认目标为 DNSPod 则改走 DNSPod，否则清空站点。
   * inferCloudflareZone：保存配置时为 Cloudflare 推断站点；展示生效配置时只为 DNSPod 推断。
   */
  private async resolve(
    saasProviderId: string,
    fqdnRaw: string,
    input: SyncPreference,
    inferCloudflareZone: boolean
  ): Promise<SyncPreference> {
    const fqdn = normalizeFqdn(fqdnRaw)
    let { sync_target: target, sync_provider_id: provider, sync_zone: zone } = input

    if (isMismatchedCloudflareZone(input, fqdn)) {
      if ((await this.defaultSyncTarget(saasProviderId)) === 'dnspod') {
        target = 'dnspod'
        provider = ''
      }
      zone = ''
    }
    target ||= await this.defaultSyncTarget(saasProviderId)
    provider ||= await this.defaultSyncProviderId(saasProviderId, target)
    if (zone === '' && (target === 'dnspod' || inferCloudflareZone)) zone = guessZoneFromFqdn(fqdn)

    return { sync_target: target, sync_provider_id: provider, sync_zone: zone, auto_preferred: input.auto_preferred }
  }

  private requireSaaS(saasProviderId: string): Promise<SaaSProvider> {
    return this.providers.requireType<SaaSProvider>(
      saasProviderId,
      'saas',
      'SaaS provider not found',
      'saas_provider_not_found'
    )
  }
}

/** Cloudflare DNS 目标但站点不覆盖主机名（脏配置） */
function isMismatchedCloudflareZone(config: SyncPreference, fqdn: string): boolean {
  return config.sync_target === 'cloudflare_dns' && config.sync_zone !== '' && !zoneOwnsHostname(config.sync_zone, fqdn)
}
