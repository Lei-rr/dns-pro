import type { ProviderRepository } from '../../../core/providers/provider.repository.js'
import type { ProviderIntegrity } from '../../../core/providers/provider-integrity.js'
import type { Provider } from '../../../core/providers/provider.types.js'
import { ApiError } from '../../../core/http/api-error.js'
import { normalizeFqdn } from '../../../shared/values.js'
import type { JsonStore } from '../../../core/store/json-store.js'
import type { SaaSPreferencesFile } from '../../../core/store/store-shapes.js'
import type { SaaSPreferencePort } from '../../../core/contracts/saas-preference.port.js'
import { zoneOwnsHostname } from './saas-hostname-rules.js'

export interface HostnamePreference {
  [key: string]: unknown
  /** 主机名 FQDN（身份索引，同时用于旧键收编） */
  hostname: string
  /** 远端主机名 ID：仅作辅助索引，键不依赖它 */
  hostname_id: string
  preferred_domain: string
  sync_target: string
  sync_provider_id: string
  sync_zone: string
  auto_preferred: boolean
  ownership_txt_cleaned: boolean
}

/** 形状权威在 store 注册表同层；此处再导出，既有导入路径不变 */
export type { SaaSPreferencesFile } from '../../../core/store/store-shapes.js'

export type SyncPreference = Pick<
  HostnamePreference,
  'sync_target' | 'sync_provider_id' | 'sync_zone' | 'auto_preferred'
>

/** 主机名偏好身份：站点名 + FQDN。用身份而非远端 hostnameId 作键，主机名重建后偏好仍命中 */
export interface HostnameIdentity {
  zone: string
  fqdn: string
}

const STRING_FIELDS = [
  'hostname',
  'hostname_id',
  'preferred_domain',
  'sync_target',
  'sync_provider_id',
  'sync_zone',
] as const
const SYNC_TARGET_PROVIDER_TYPE: Record<string, Provider['type']> = { dnspod: 'dnspod', cloudflare_dns: 'cloudflare' }

/** 站点名 + FQDN → 偏好键（不含服务商前缀；站点为空表示站点未知行） */
function hostnameIdentityKey(identity: HostnameIdentity): string {
  return `${normalizeFqdn(identity.zone)}:${normalizeFqdn(identity.fqdn)}`
}

/** 从 listByProvider 结果取主机名偏好：精确身份 → 站点未知行 */
export function preferenceOf(
  map: Record<string, HostnamePreference>,
  identity: HostnameIdentity
): HostnamePreference | null {
  return map[hostnameIdentityKey(identity)] ?? map[hostnameIdentityKey({ zone: '', fqdn: identity.fqdn })] ?? null
}

/**
 * SaaS 主机名本地偏好（优选域名 / DNS 同步目标 / 所有权 TXT 清理标记）。
 * 键：`<cloudflareProviderId>:<zone>:<fqdn>`（站点未知时 `<zone>` 为空）；
 * 旧版 `<cloudflareProviderId>:<hostnameId>` 行在启动 `pruneOrphans` 或下次写入时按行内 hostname 收编，不丢数据。
 * 所有写入在 ProviderIntegrity 串行锁内校验引用。
 * 存储读写经端口 SaaSPreferencePort 供编排消费（删除流程的清理标记、服务商依赖反查）。
 */
export class SaaSPreferenceService implements SaaSPreferencePort {
  constructor(
    private readonly store: JsonStore<SaaSPreferencesFile>,
    private readonly integrity: ProviderIntegrity,
    private readonly providers: ProviderRepository
  ) {}

  async get(cloudflareProviderId: string, identity: HostnameIdentity): Promise<HostnamePreference | null> {
    const items = await this.readItems()
    const key = resolveStoredKey(items, cloudflareProviderId, identity, '')
    const row = key === '' ? undefined : items[key]
    return isRow(row) ? presentPreference(row) : null
  }

  /** 某 Cloudflare 服务商下的全部偏好，键为身份键（站点未知行为 `:<fqdn>`） */
  async listByProvider(cloudflareProviderId: string): Promise<Record<string, HostnamePreference>> {
    const prefix = `${cloudflareProviderId}:`
    const result: Record<string, HostnamePreference> = {}
    for (const [key, value] of Object.entries(await this.readItems())) {
      if (!key.startsWith(prefix) || !isRow(value)) continue
      const stored = key.slice(prefix.length)
      // 旧 `<hostnameId>` 键：只能靠行内 hostname 定位，按站点未知收编；无 hostname 的旧行由 pruneOrphans 清理
      if (!stored.includes(':')) {
        const fqdn = normalizeFqdn(value.hostname)
        if (fqdn !== '' && result[fqdnOnlyKey(fqdn)] === undefined) result[fqdnOnlyKey(fqdn)] = presentPreference(value)
        continue
      }
      result[stored] = presentPreference(value)
    }
    return result
  }

  async listAll(options: { fresh?: boolean } = {}): Promise<Record<string, HostnamePreference>> {
    const result: Record<string, HostnamePreference> = {}
    for (const [key, value] of Object.entries(await this.readItems(options))) {
      if (isRow(value)) result[key] = presentPreference(value)
    }
    return result
  }

  setPreferredDomain(
    cloudflareProviderId: string,
    identity: HostnameIdentity,
    preferredDomain: string,
    hostnameId = ''
  ) {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, identity, hostnameId, { preferred_domain: preferredDomain.trim() })
    )
  }

  /**
   * 优选域名 + 同步配置合并写入（单事务）。
   * 分两次写会在中间失败时留下「优选域名已换、同步配置未换」的半截状态：远端 DNS 已按新优选写回，
   * 本地却按旧配置继续同步，面板每次读到的取值都不一致。校验由调用方在远端变更前完成（validateSyncConfig）。
   * 传 null 表示本次不提交该字段；两者都为 null 时不产生任何变更，调用方不应这样调用。
   */
  setPreferredAndSync(input: {
    cloudflareProviderId: string
    identity: HostnameIdentity
    hostnameId?: string
    preferredDomain: string | null
    sync: SyncPreference | null
  }): Promise<HostnamePreference> {
    const changes: Partial<HostnamePreference> = {}
    if (input.preferredDomain !== null) changes.preferred_domain = input.preferredDomain.trim()
    if (input.sync !== null) Object.assign(changes, toSyncChanges(input.sync))
    return this.withOwner(input.cloudflareProviderId, () =>
      this.save(input.cloudflareProviderId, input.identity, input.hostnameId ?? '', changes)
    )
  }

  /** 校验同步服务商引用（创建远端资源前预检用） */
  async validateSyncConfig(cloudflareProviderId: string, sync: SyncPreference): Promise<void> {
    await this.withOwner(cloudflareProviderId, async (providers) => assertSyncProvider(sync, providers))
  }

  /** 校验并保存同步配置（校验与写入在同一把锁内） */
  setSyncConfig(input: {
    cloudflareProviderId: string
    identity: HostnameIdentity
    hostnameId?: string
    syncTarget: string
    syncProviderId: string
    syncZone: string
    autoPreferred: boolean
  }): Promise<HostnamePreference> {
    const sync: SyncPreference = {
      sync_target: input.syncTarget,
      sync_provider_id: input.syncProviderId,
      sync_zone: input.syncZone,
      auto_preferred: input.autoPreferred,
    }
    return this.withOwner(input.cloudflareProviderId, async (providers) => {
      assertSyncProvider(sync, providers)
      return this.save(input.cloudflareProviderId, input.identity, input.hostnameId ?? '', toSyncChanges(sync))
    })
  }

  /** 保存已在远端变更前校验过的同步配置（远端已不可回滚，不再重复校验） */
  setNormalizedSyncConfig(
    cloudflareProviderId: string,
    identity: HostnameIdentity,
    sync: SyncPreference,
    hostnameId = ''
  ) {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, identity, hostnameId, toSyncChanges(sync))
    )
  }

  /**
   * 所有权 TXT 清理标记：调用方（工作流）只有 hostnameId，故按 id 定位行；
   * 行不存在时以「站点未知」身份落行，下次带站点的写入会把它收编到身份键。
   */
  async ownershipTxtCleaned(cloudflareProviderId: string, hostnameId: string): Promise<boolean> {
    const items = await this.readItems()
    const key = findKeyByHostnameId(items, cloudflareProviderId, hostnameId)
    const row = key === '' ? undefined : items[key]
    return isRow(row) ? Boolean(row.ownership_txt_cleaned ?? false) : false
  }

  markOwnershipTxtCleaned(
    cloudflareProviderId: string,
    hostnameId: string,
    cleaned: boolean,
    hostname = ''
  ): Promise<HostnamePreference> {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, { zone: '', fqdn: hostname }, hostnameId, { ownership_txt_cleaned: cleaned })
    )
  }

  /** 清除某主机名的全部偏好（身份键 + 站点未知键 + 旧 id 键，按行内 hostname 归并） */
  async clearForFqdn(cloudflareProviderId: string, hostnameFqdn: string): Promise<number> {
    const fqdn = normalizeFqdn(hostnameFqdn)
    if (fqdn === '') return 0
    let removed = 0
    await this.integrity.run(() =>
      this.store.transaction((current) => {
        const items = { ...(current.items ?? {}) }
        for (const [key, value] of Object.entries(items)) {
          if (!key.startsWith(`${cloudflareProviderId}:`) || !isRow(value)) continue
          if (normalizeFqdn(value.hostname) !== fqdn) continue
          delete items[key]
          removed++
        }
        return { next: { items } }
      })
    )
    return removed
  }

  /**
   * 启动时清理/收编孤儿偏好：
   * 1) 旧 `<hostnameId>` 键行按行内 hostname 收编为 `<zone>:<fqdn>`（站点未知，键 `:<fqdn>`）；
   * 2) 无 hostname 的旧行无法归属，直接移除；
   * 3) 所属 Cloudflare 已删除则移除；同步服务商已删除则重置同步目标。
   */
  async pruneOrphans(validCloudflareIds: Set<string>, validProviderIds: Set<string>) {
    let removedCount = 0
    let repairedCount = 0
    await this.integrity.run(() =>
      this.store.transaction((current) => {
        const items: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(current.items ?? {})) {
          const cfId = key.includes(':') ? key.slice(0, key.indexOf(':')) : ''
          if (!validCloudflareIds.has(cfId) || !isRow(value)) {
            removedCount++
            continue
          }
          const target = migratedKey(cfId, key, value)
          if (target === '') {
            removedCount++
            continue
          }
          if (target !== key) repairedCount++
          const row =
            target === key ? value : { ...value, hostname_id: String(value.hostname_id ?? '') || legacyId(key) }
          const syncProviderId = String(row.sync_provider_id ?? '').trim()
          if (syncProviderId !== '' && !validProviderIds.has(syncProviderId)) {
            // 同步目标已删除：target/provider/zone 必须一起清空，否则残留 zone 会被当成有效配置
            items[target] = { ...row, sync_provider_id: '', sync_target: '', sync_zone: '' }
            repairedCount++
          } else {
            items[target] = row
          }
        }
        return { next: { items } }
      })
    )
    return { removedCount, repairedCount }
  }

  private withOwner<T>(cloudflareProviderId: string, task: (providers: Provider[]) => Promise<T>): Promise<T> {
    return this.integrity.run(async () => {
      const providers = await this.providers.all({ fresh: true })
      const owner = providers.find((provider) => provider.id === cloudflareProviderId)
      if (!owner || owner.type !== 'cloudflare') {
        throw new ApiError('provider_reference_not_found', 'SaaS owner provider not found or has invalid type', 422)
      }
      return task(providers)
    })
  }

  private async readItems(options: { fresh?: boolean } = {}): Promise<Record<string, unknown>> {
    const file = options.fresh ? await this.store.readFresh() : await this.store.read()
    return file.items ?? {}
  }

  /** 合并写入；所有字段回到默认值时删除该行。写入即收编：命中的旧键行会被迁移到身份键 */
  private async save(
    cloudflareProviderId: string,
    identity: HostnameIdentity,
    hostnameId: string,
    changes: Partial<HostnamePreference>
  ): Promise<HostnamePreference> {
    const fqdn = normalizeFqdn(identity.fqdn)
    let saved = presentPreference({})
    await this.store.transaction((current) => {
      const items = { ...(current.items ?? {}) }
      const existingKey = resolveStoredKey(items, cloudflareProviderId, identity, hostnameId)
      // 有站点信息就写身份键；站点未知的调用（所有权标记）保留已命中的键，避免把已知站点降级
      const siteLess = normalizeFqdn(identity.zone) === ''
      const writeKey =
        fqdn === ''
          ? existingKey
          : siteLess && existingKey !== ''
            ? existingKey
            : exactKey(cloudflareProviderId, identity)
      if (writeKey === '') return { next: { items } }

      const row = presentPreference(isRow(items[existingKey]) ? items[existingKey] : {})
      if (hostnameId.trim() !== '') row.hostname_id = hostnameId.trim()
      for (const field of STRING_FIELDS) if (field in changes) row[field] = String(changes[field] ?? '')
      if ('auto_preferred' in changes) row.auto_preferred = Boolean(changes.auto_preferred)
      if ('ownership_txt_cleaned' in changes) row.ownership_txt_cleaned = Boolean(changes.ownership_txt_cleaned)
      if (fqdn !== '') row.hostname = fqdn
      saved = row

      // 收编：同 FQDN 的站点未知/旧 id 行并入身份键，不再留孤儿
      for (const key of Object.keys(items)) {
        if (key === writeKey || key === existingKey) continue
        if (key.startsWith(`${cloudflareProviderId}:`) && isAdoptable(items[key], key, fqdn, identity.zone)) {
          delete items[key]
        }
      }
      if (existingKey !== '' && existingKey !== writeKey) delete items[existingKey]

      const isEmpty =
        STRING_FIELDS.every((field) => INDEX_FIELDS.has(field) || row[field] === '') &&
        row.hostname === '' &&
        !row.auto_preferred &&
        !row.ownership_txt_cleaned
      if (isEmpty) delete items[writeKey]
      else items[writeKey] = row
      return { next: { items } }
    })
    return saved
  }
}

/** hostname / hostname_id 是索引字段，不参与「空行即删除」判定 */
const INDEX_FIELDS = new Set(['hostname', 'hostname_id'])

/** 身份键全键 */
function exactKey(cloudflareProviderId: string, identity: HostnameIdentity): string {
  return `${cloudflareProviderId}:${hostnameIdentityKey(identity)}`
}

/** 只带 FQDN 的站点未知键（相对 items 的完整键） */
function fqdnOnlyKey(fqdn: string): string {
  return `:${normalizeFqdn(fqdn)}`
}

function isAdoptable(value: unknown, key: string, fqdn: string, zone: string): boolean {
  if (!isRow(value) || fqdn === '' || normalizeFqdn(value.hostname) !== fqdn) return false
  const parts = key.slice(key.indexOf(':') + 1).split(':')
  // 站点已知的行不参与收编，避免跨站点误认
  if (parts.length === 2 && (parts[0] ?? '') !== '') return false
  // 站点未知/旧 id 行：只有写入站点确实托管该 FQDN 时才收编，否则它多半属于别的站点
  return zoneOwnsHostname(zone, fqdn)
}

/** 定位偏好行：精确身份键 → 同 FQDN 的站点未知/旧 id 行 → 行内 hostname_id */
function resolveStoredKey(
  items: Record<string, unknown>,
  cloudflareProviderId: string,
  identity: HostnameIdentity,
  hostnameId: string
): string {
  const exact = exactKey(cloudflareProviderId, identity)
  if (isRow(items[exact])) return exact
  const fqdn = normalizeFqdn(identity.fqdn)
  const zone = normalizeFqdn(identity.zone)
  for (const [key, value] of Object.entries(items)) {
    if (!key.startsWith(`${cloudflareProviderId}:`) || !isRow(value)) continue
    if (fqdn !== '' && isAdoptable(value, key, fqdn, zone)) return key
    // 只有站点未知的调用（工作流按 hostnameId 寻址）才允许跨站点按 id 命中：
    // 带站点时 id 相同只说明主机名在别的站点，那行绝不能动
    if (zone === '' && hostnameId !== '' && String(value.hostname_id ?? '') === hostnameId) return key
  }
  return ''
}

function findKeyByHostnameId(items: Record<string, unknown>, cloudflareProviderId: string, hostnameId: string): string {
  if (hostnameId === '') return ''
  const prefix = `${cloudflareProviderId}:`
  for (const [key, value] of Object.entries(items)) {
    if (!key.startsWith(prefix) || !isRow(value)) continue
    // 旧键把 hostnameId 编在键里，新键存在行内
    if (String(value.hostname_id ?? '') === hostnameId || legacyId(key) === hostnameId) return key
  }
  return ''
}

/** 旧键 `<cfId>:<hostnameId>` 里的 hostnameId（新键含站点段，返回空串） */
function legacyId(key: string): string {
  const stored = key.slice(key.indexOf(':') + 1)
  return stored.includes(':') ? '' : stored
}

/**
 * 键模型收编：旧 `<cfId>:<hostnameId>` 行按行内 hostname 迁移为 `<cfId>:<fqdn>`；
 * 返回空串表示该行无法归属（无 hostname），应删除。
 */
function migratedKey(cfId: string, key: string, value: Record<string, unknown>): string {
  if (legacyId(key) === '') return key
  const fqdn = normalizeFqdn(value.hostname)
  return fqdn === '' ? '' : `${cfId}:${fqdnOnlyKey(fqdn)}`
}

function toSyncChanges(sync: SyncPreference): Partial<HostnamePreference> {
  return {
    sync_target: sync.sync_target.trim(),
    sync_provider_id: sync.sync_provider_id.trim(),
    sync_zone: sync.sync_zone.trim().toLowerCase(),
    auto_preferred: Boolean(sync.auto_preferred),
  }
}

function isRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function presentPreference(row: Record<string, unknown>): HostnamePreference {
  return {
    hostname: String(row.hostname ?? ''),
    hostname_id: String(row.hostname_id ?? ''),
    preferred_domain: String(row.preferred_domain ?? ''),
    sync_target: String(row.sync_target ?? ''),
    sync_provider_id: String(row.sync_provider_id ?? ''),
    sync_zone: String(row.sync_zone ?? ''),
    auto_preferred: Boolean(row.auto_preferred ?? false),
    ownership_txt_cleaned: Boolean(row.ownership_txt_cleaned ?? false),
  }
}

/** 同步目标与服务商必须同时为空或类型匹配 */
function assertSyncProvider(sync: SyncPreference, providers: Provider[]): void {
  const target = sync.sync_target.trim()
  const providerId = sync.sync_provider_id.trim()
  if (!target && !providerId) return
  const requiredType = SYNC_TARGET_PROVIDER_TYPE[target]
  if (!requiredType || !providerId) {
    throw new ApiError('validation_failed', 'Invalid SaaS sync provider configuration', 422)
  }
  const provider = providers.find((item) => item.id === providerId)
  if (!provider || provider.type !== requiredType) {
    throw new ApiError('provider_reference_not_found', 'SaaS sync provider not found or has invalid type', 422)
  }
}
