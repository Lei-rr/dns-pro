import type { ProviderRepository } from '../../../core/providers/provider.repository.js'
import type { SaaSProvider } from '../../../core/providers/provider.types.js'
import { ApiError } from '../../../core/http/api-error.js'
import { normalizeFqdn, toText } from '../../../shared/values.js'
import type { SaaSSyncDefaultsPort, SyncTarget } from '../../../core/contracts/saas-sync-config.port.js'
import { parseSyncTarget, unsupportedSyncTarget } from '../../../core/contracts/saas-sync-config.port.js'
import type { CloudflareCustomHostname } from './saas-custom-hostname.client.js'
import { guessZoneFromFqdn, zoneOwnsHostname, effectivePreferredDomain } from './saas-hostname-rules.js'
import type { HostnamePreference, SaaSPreferenceService, SyncPreference } from './saas-preference.service.js'
import { preferenceOf } from './saas-preference.service.js'

type ExplicitSyncConfig = SyncPreference & { hostname: string }
type EffectiveSyncConfig = ExplicitSyncConfig & { explicit: boolean }

/** 主机名 + 本地偏好合并后的形状：读路径的生效配置与写路径的响应都由它派生 */
export type MergedHostname = CloudflareCustomHostname & Partial<HostnamePreference>

const zoneText = (value: unknown) => toText(value).toLowerCase()

/** SaaS DNS 同步配置解析与脏数据修复（与主机名 CRUD 解耦）；服务商默认值经端口 SaaSSyncDefaultsPort 供编排消费 */
export class SaaSSyncConfigService implements SaaSSyncDefaultsPort {
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

  /** 偏好查询：已知站点时按身份键精确命中，避免同 FQDN 跨站点互相命中；未知站点时按 FQDN 兜底 */
  async preferenceForFqdn(
    cloudflareProviderId: string,
    hostnameFqdn: string,
    zoneName = ''
  ): Promise<HostnamePreference | null> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    if (fqdn === '') return null
    const map = await this.preferences.listByProvider(cloudflareProviderId)
    if (zoneName.trim() !== '') return preferenceOf(map, { zone: zoneName, fqdn })
    return Object.values(map).find((pref) => normalizeFqdn(pref.hostname) === fqdn) ?? null
  }

  async clearPreferencesForFqdn(cloudflareProviderId: string, hostnameFqdn: string): Promise<number> {
    return this.preferences.clearForFqdn(cloudflareProviderId, hostnameFqdn)
  }

  presentExplicit(preference: Partial<HostnamePreference> | null | undefined): ExplicitSyncConfig {
    return {
      hostname: toText(preference?.hostname),
      // 存储行里的目标值在这里显式解析：脏值（手改 JSON / 旧版本写入）直接 422，不静默当成未配置
      sync_target: parseSyncTarget(preference?.sync_target),
      sync_provider_id: toText(preference?.sync_provider_id),
      sync_zone: zoneText(preference?.sync_zone),
      auto_preferred: Boolean(preference?.auto_preferred),
    }
  }

  /** 服务商默认同步目标：配置了 DNSPod 优先，否则 Cloudflare DNS */
  async defaultSyncTarget(saasProviderId: string): Promise<SyncTarget> {
    const provider = await this.requireSaaS(saasProviderId)
    if (toText(provider.dnspod_provider)) return 'dnspod'
    if (toText(provider.cloudflare_dns_provider) || toText(provider.cloudflare_provider)) return 'cloudflare_dns'
    return ''
  }

  /** 目标对应的默认同步服务商 */
  async defaultSyncProviderId(saasProviderId: string, target: SyncTarget): Promise<string> {
    const provider = await this.requireSaaS(saasProviderId)
    switch (target) {
      case 'dnspod':
        return toText(provider.dnspod_provider)
      case 'cloudflare_dns':
        return toText(provider.cloudflare_dns_provider) || toText(provider.cloudflare_provider)
      case '':
        return ''
      default:
        return unsupportedSyncTarget(target)
    }
  }

  /** 显式配置 + 默认值 → 生效配置；Cloudflare 目标站点不覆盖主机名时回退 */
  async effectiveSyncConfig(
    saasProviderId: string,
    hostnameFqdn: string,
    explicit: ExplicitSyncConfig
  ): Promise<EffectiveSyncConfig> {
    const resolved = await this.resolve(saasProviderId, hostnameFqdn, explicit)
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

    // 已存配置先按原始值读取：脏值只在真正要沿用它时才解析失败，显式提交能直接覆盖修复
    const storedRaw = {
      sync_target: toText(existing?.sync_target),
      sync_provider_id: toText(existing?.sync_provider_id),
      sync_zone: zoneText(existing?.sync_zone),
      auto_preferred: Boolean(existing?.auto_preferred),
    }
    const explicitTarget = parseSyncTarget(data.sync_target)
    // 目标被显式切换时旧目标的 provider 不再适用：未显式提交就交回 resolve 取新目标的默认服务商，
    // 否则旧值会把 provider ||= 短路掉，落成目标与类型不匹配的配置（写入时 422 provider_reference_not_found）
    const switched = explicitTarget !== '' && explicitTarget !== storedRaw.sync_target
    let candidate: SyncPreference = {
      sync_target: explicitTarget || parseSyncTarget(storedRaw.sync_target),
      sync_provider_id: toText(data.sync_provider_id) || (switched ? '' : storedRaw.sync_provider_id),
      sync_zone: zoneText(data.sync_zone) || storedRaw.sync_zone,
      auto_preferred: 'auto_preferred' in data ? Boolean(data.auto_preferred) : storedRaw.auto_preferred,
    }
    // 请求组合非法时先回退到已存配置，已存配置也非法则清空
    if (isMismatchedCloudflareZone(candidate, fqdn)) {
      const stored: SyncPreference = { ...storedRaw, sync_target: parseSyncTarget(storedRaw.sync_target) }
      candidate = isMismatchedCloudflareZone(stored, fqdn)
        ? { ...candidate, sync_target: '', sync_provider_id: '', sync_zone: '' }
        : { ...stored, auto_preferred: candidate.auto_preferred }
    }
    return this.resolve(saasProviderId, fqdn, candidate)
  }

  /**
   * 合并 Cloudflare 主机名与本地偏好；本地偏好优先。
   * 取值顺序与派生记录侧（effectivePreferredDomain）、前端展示共用同一实现，
   * 避免同一主机名在「读接口」「DNS 写回」「一键切换」之间出现两个优选域名。
   */
  mergePreference(hostname: CloudflareCustomHostname, preference: HostnamePreference | null): MergedHostname {
    const metadata = { ...(hostname.custom_metadata ?? {}) }
    const preferred = effectivePreferredDomain(hostname, preference)
    if (preferred !== '') metadata.preferred_domain = preferred

    return {
      ...hostname,
      custom_metadata: Object.keys(metadata).length > 0 ? metadata : null,
      preferred_domain: preferred,
      sync_target: toText(preference?.sync_target ?? hostname.sync_target),
      sync_provider_id: toText(preference?.sync_provider_id ?? hostname.sync_provider_id),
      sync_zone: toText(preference?.sync_zone ?? hostname.sync_zone),
      auto_preferred: preference ? preference.auto_preferred : Boolean(hostname.auto_preferred),
    }
  }

  /** 仅在 Cloudflare 托管字段实际变化时生成 PATCH 内容；优选/同步字段属于本地偏好 */
  buildCloudflareUpdatePayload(current: CloudflareCustomHostname, data: Record<string, unknown>) {
    const payload: Record<string, unknown> = {}
    if (Object.hasOwn(data, 'custom_origin_server')) {
      const next = toText(data.custom_origin_server)
      if (next !== toText(current.custom_origin_server)) payload.custom_origin_server = next
    }
    const method = toText(data.method)
    if (method !== '' && method !== toText(current.ssl?.method)) payload.method = method
    const minTls = toText(data.min_tls_version)
    if (minTls !== '' && minTls !== toText(current.ssl?.settings?.min_tls_version)) payload.min_tls_version = minTls
    return payload
  }

  /**
   * 填充默认值并修复脏配置：Cloudflare 站点不覆盖主机名时，默认目标为 DNSPod 则改走 DNSPod，否则清空站点。
   *
   * 站点只对 DNSPod 目标做后缀猜测：DNSPod 侧按域名列表做最长后缀匹配，猜错可自愈。
   * Cloudflare 站点必须真实存在，若把猜测值落库，读取侧会优先采用它
   * （见 saas.planner 的 resolveCloudflareSaasTarget），多级子域会指向账号内不存在的站点而直接失败。
   * 因此 Cloudflare 目标一律留空，交由读取侧用域名列表解析。
   */
  private async resolve(saasProviderId: string, fqdnRaw: string, input: SyncPreference): Promise<SyncPreference> {
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
    if (zone === '' && target === 'dnspod') zone = guessZoneFromFqdn(fqdn)

    return { sync_target: target, sync_provider_id: provider, sync_zone: zone, auto_preferred: input.auto_preferred }
  }

  private requireSaaS(saasProviderId: string): Promise<SaaSProvider> {
    return this.providers.requireType(saasProviderId, 'saas', 'SaaS provider not found', 'saas_provider_not_found')
  }
}

/** Cloudflare DNS 目标但站点不覆盖主机名（脏配置） */
function isMismatchedCloudflareZone(config: SyncPreference, fqdn: string): boolean {
  return (
    config.sync_target === 'cloudflare_dns' &&
    config.sync_zone !== '' &&
    !zoneOwnsHostname({ zone: config.sync_zone, fqdn })
  )
}
