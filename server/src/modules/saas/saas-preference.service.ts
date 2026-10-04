import type { ProviderRepository } from '../providers/provider.repository.js'
import type { ProviderIntegrity } from '../providers/provider-integrity.js'
import type { Provider } from '../providers/provider.types.js'
import { ApiError } from '../../shared/http/api-error.js'
import type { JsonStore } from '../../platform/storage/json-store.js'

export interface HostnamePreference {
  [key: string]: unknown
  hostname: string
  preferred_domain: string
  sync_target: string
  sync_provider_id: string
  sync_zone: string
  auto_preferred: boolean
  ownership_txt_cleaned: boolean
}

/** data/saas/preferences.json */
export interface SaaSPreferencesFile {
  items: Record<string, unknown>
}

export type SyncPreference = Pick<
  HostnamePreference,
  'sync_target' | 'sync_provider_id' | 'sync_zone' | 'auto_preferred'
>

const STRING_FIELDS = ['hostname', 'preferred_domain', 'sync_target', 'sync_provider_id', 'sync_zone'] as const
const SYNC_TARGET_PROVIDER_TYPE: Record<string, Provider['type']> = { dnspod: 'dnspod', cloudflare_dns: 'cloudflare' }

/**
 * SaaS 主机名本地偏好（优选域名 / DNS 同步目标 / 所有权 TXT 清理标记）。
 * 键：`<cloudflareProviderId>:<hostnameId>`；所有写入在 ProviderIntegrity 串行锁内校验引用。
 */
export class SaaSPreferenceService {
  constructor(
    private readonly store: JsonStore<SaaSPreferencesFile>,
    private readonly integrity: ProviderIntegrity,
    private readonly providers: ProviderRepository
  ) {}

  async get(cloudflareProviderId: string, hostnameId: string): Promise<HostnamePreference | null> {
    const row = (await this.readItems())[preferenceKey(cloudflareProviderId, hostnameId)]
    return isRow(row) ? presentPreference(row) : null
  }

  /** 某 Cloudflare 服务商下的全部偏好，键为 hostnameId */
  async listByProvider(cloudflareProviderId: string): Promise<Record<string, HostnamePreference>> {
    const prefix = `${cloudflareProviderId}:`
    const result: Record<string, HostnamePreference> = {}
    for (const [key, value] of Object.entries(await this.readItems())) {
      const hostnameId = key.startsWith(prefix) ? key.slice(prefix.length) : ''
      if (hostnameId !== '' && isRow(value)) result[hostnameId] = presentPreference(value)
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

  setPreferredDomain(cloudflareProviderId: string, hostnameId: string, preferredDomain: string) {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, hostnameId, { preferred_domain: preferredDomain.trim() })
    )
  }

  /** 校验同步服务商引用（创建远端资源前预检用） */
  async validateSyncConfig(cloudflareProviderId: string, sync: SyncPreference): Promise<void> {
    await this.withOwner(cloudflareProviderId, async (providers) => assertSyncProvider(sync, providers))
  }

  /** 校验并保存同步配置（校验与写入在同一把锁内） */
  setSyncConfig(input: {
    cloudflareProviderId: string
    hostnameId: string
    syncTarget: string
    syncProviderId: string
    syncZone: string
    autoPreferred: boolean
    hostname?: string
  }): Promise<HostnamePreference> {
    const sync: SyncPreference = {
      sync_target: input.syncTarget,
      sync_provider_id: input.syncProviderId,
      sync_zone: input.syncZone,
      auto_preferred: input.autoPreferred,
    }
    return this.withOwner(input.cloudflareProviderId, async (providers) => {
      assertSyncProvider(sync, providers)
      return this.save(input.cloudflareProviderId, input.hostnameId, toSyncChanges(sync, input.hostname))
    })
  }

  /** 保存已在远端变更前校验过的同步配置（远端已不可回滚，不再重复校验） */
  setNormalizedSyncConfig(cloudflareProviderId: string, hostnameId: string, sync: SyncPreference, hostname = '') {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, hostnameId, toSyncChanges(sync, hostname))
    )
  }

  async ownershipTxtCleaned(cloudflareProviderId: string, hostnameId: string): Promise<boolean> {
    return (await this.get(cloudflareProviderId, hostnameId))?.ownership_txt_cleaned ?? false
  }

  markOwnershipTxtCleaned(cloudflareProviderId: string, hostnameId: string, cleaned: boolean, hostname = '') {
    return this.withOwner(cloudflareProviderId, () =>
      this.save(cloudflareProviderId, hostnameId, { hostname: hostname.trim(), ownership_txt_cleaned: cleaned })
    )
  }

  async clear(cloudflareProviderId: string, hostnameId: string): Promise<void> {
    const key = preferenceKey(cloudflareProviderId, hostnameId)
    await this.integrity.run(() =>
      this.store.transaction((current) => {
        const items = { ...(current.items ?? {}) }
        delete items[key]
        return { next: { items } }
      })
    )
  }

  /** 启动时清理孤儿偏好：所属 Cloudflare 已删除则移除；同步服务商已删除则重置同步目标 */
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
          const syncProviderId = String(value.sync_provider_id ?? '').trim()
          if (syncProviderId !== '' && !validProviderIds.has(syncProviderId)) {
            // 同步目标已删除：target/provider/zone 必须一起清空，否则残留 zone 会被当成有效配置
            items[key] = { ...value, sync_provider_id: '', sync_target: '', sync_zone: '' }
            repairedCount++
          } else {
            items[key] = value
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

  /** 合并写入；所有字段回到默认值时删除该行 */
  private async save(
    cloudflareProviderId: string,
    hostnameId: string,
    changes: Partial<HostnamePreference>
  ): Promise<HostnamePreference> {
    const key = preferenceKey(cloudflareProviderId, hostnameId)
    let saved = presentPreference({})
    await this.store.transaction((current) => {
      const items = { ...(current.items ?? {}) }
      const row = presentPreference(isRow(items[key]) ? items[key] : {})
      for (const field of STRING_FIELDS) if (field in changes) row[field] = String(changes[field] ?? '')
      if ('auto_preferred' in changes) row.auto_preferred = Boolean(changes.auto_preferred)
      if ('ownership_txt_cleaned' in changes) row.ownership_txt_cleaned = Boolean(changes.ownership_txt_cleaned)
      saved = row

      // hostname 是 FQDN 索引，保留它可让后续查询走本地快路径
      const isEmpty =
        STRING_FIELDS.every((field) => field === 'hostname' || row[field] === '') &&
        row.hostname === '' &&
        !row.auto_preferred &&
        !row.ownership_txt_cleaned
      if (isEmpty) delete items[key]
      else items[key] = row
      return { next: { items } }
    })
    return saved
  }
}

function toSyncChanges(sync: SyncPreference, hostname = ''): Partial<HostnamePreference> {
  return {
    hostname: hostname.trim(),
    sync_target: sync.sync_target.trim(),
    sync_provider_id: sync.sync_provider_id.trim(),
    sync_zone: sync.sync_zone.trim().toLowerCase(),
    auto_preferred: Boolean(sync.auto_preferred),
  }
}

function preferenceKey(cloudflareProviderId: string, hostnameId: string): string {
  return `${cloudflareProviderId}:${hostnameId}`
}

function isRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function presentPreference(row: Record<string, unknown>): HostnamePreference {
  return {
    hostname: String(row.hostname ?? ''),
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
