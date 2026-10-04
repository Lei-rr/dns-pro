import { ApiError } from '../../shared/http/api-error.js'
import {
  buildDnsSideEffects,
  toCleanupSideEffect,
  toSyncSideEffect,
  type SideEffects,
} from '../../shared/providers/side-effect-result.js'
import type { CloudflareCustomHostname } from '../../modules/saas/saas-custom-hostname.client.js'
import { isHostnameActive } from '../../modules/saas/saas-hostname-rules.js'
import type { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'
import type { SaaSPreferenceService } from '../../modules/saas/saas-preference.service.js'
import { invalidateSaaSHostnameCache, invalidateSaaSHostnameDetailsCache } from '../../modules/saas/saas.cache.js'
import type { SaaSDnsSyncCoordinator } from './saas-dns-sync.coordinator.js'
import type { SyncCollectedRecords, SyncRecord } from './saas-sync-records.js'

export type SaaSDeleteCleanupRecipe = SyncCollectedRecords

type SaaSDeleteOptions = {
  primaryDeleted?: boolean
  cleanup?: SaaSDeleteCleanupRecipe
  onCleanupPrepared?: (cleanup: SaaSDeleteCleanupRecipe) => Promise<void>
  onPrimaryDeleted?: () => Promise<void>
  /**
   * 批量任务中只失效主机名详情缓存，列表缓存留到任务结束统一失效。
   * 避免逐条失效导致下一条目重新分页拉取整站主机名（O(N²)）。
   */
  deferListInvalidation?: boolean
}

type SaaSUpdateOptions = {
  remoteApplied?: boolean
  beforeRecords?: SyncRecord[]
  onBeforeRecordsPrepared?: (records: SyncRecord[]) => Promise<void>
  deferListInvalidation?: boolean
}

// 这些字段影响 DNS 记录，修改后必须重同步
const DNS_LINKED_FIELDS = ['preferred_domain', 'auto_preferred', 'sync_target', 'sync_zone', 'sync_provider_id']

/**
 * SaaS 主机名生命周期 + DNS 副作用编排。
 * 删除顺序：保存清理配方 → 删除 Cloudflare 主机名 → 清理 DNS；批量重试可跳过已完成阶段。
 */
export class SaaSDnsSyncWorkflow {
  constructor(
    private readonly hostnames: SaaSHostnameService,
    private readonly preferences: SaaSPreferenceService,
    private readonly sync: SaaSDnsSyncCoordinator
  ) {}

  /** 本工作流会写入的底层 DNS 资源键（供批量任务做跨工作流互斥） */
  resourceKeys(providerId: string, zoneName: string): Promise<string[]> {
    return this.sync.resourceKeys(providerId, zoneName)
  }

  async createHostname(providerId: string, zoneName: string, data: Record<string, unknown>, autoSync = false) {
    const owner = await this.hostnames.resolveZoneRef(providerId, zoneName)
    if (autoSync) await this.sync.preflight(providerId, String(data.hostname ?? ''), data)

    const result = await this.hostnames.createHostname(providerId, zoneName, data)
    invalidateSaaSHostnameCache(owner.cloudflareProviderId, owner.zoneId, true)
    if (!autoSync || !result.hostname || hasLocalError(result)) return presentMutation(result)

    const sync = await this.sync.sync(providerId, zoneName, result.hostname)
    return withDnsEffects(result, { sync: toSyncSideEffect(sync, '已执行 DNS 同步') })
  }

  async updateHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    data: Record<string, unknown>,
    autoSync = false,
    options: SaaSUpdateOptions = {}
  ) {
    const owner = await this.hostnames.resolveZoneRef(providerId, zoneName)
    const shouldSync = autoSync || DNS_LINKED_FIELDS.some((field) => field in data)

    // 更新前保存记录快照，用于删除不再需要的记录
    let beforeRecords = options.beforeRecords ?? []
    if (shouldSync && options.beforeRecords === undefined) {
      beforeRecords = (await this.sync.collect(providerId, zoneName, hostnameFqdn)).records
      await options.onBeforeRecordsPrepared?.(beforeRecords)
    }

    const result = await this.hostnames.updateHostname(providerId, zoneName, hostnameFqdn, data, options)
    this.invalidateHostnameCache(owner, options.deferListInvalidation)
    if (!shouldSync || hasLocalError(result)) return presentMutation(result)

    const sync = await this.sync.resync(providerId, zoneName, hostnameFqdn, beforeRecords)
    return withDnsEffects(result, { sync: toSyncSideEffect(sync, '已执行 DNS 重同步') })
  }

  /** 刷新状态；激活后首次清理所有权 TXT */
  async reconcileHostname(providerId: string, zoneName: string, hostnameFqdn: string) {
    const result = await this.hostnames.showHostname(providerId, zoneName, hostnameFqdn, true)
    if (!(await this.shouldCleanupOwnershipTxt(providerId, result))) return result

    const cleanup = await this.sync.cleanupStale(providerId, zoneName, hostnameFqdn)
    // 仅当确实清理完成才记为已清理：skipped/未找到时留待下次重试
    const cleanupEffect = toCleanupSideEffect(cleanup, '已执行 DNS 清理')
    await this.preferences.markOwnershipTxtCleaned(
      await this.hostnames.cloudflareProviderId(providerId),
      result.id,
      cleanupEffect.status === 'completed',
      hostnameFqdn
    )
    return { ...result, side_effects: buildDnsSideEffects({ cleanup: cleanupEffect }) }
  }

  async repairHostnameDns(providerId: string, zoneName: string, hostnameFqdn: string) {
    const sync = await this.sync.sync(providerId, zoneName, hostnameFqdn)
    return {
      hostname: hostnameFqdn,
      side_effects: buildDnsSideEffects({ sync: toSyncSideEffect(sync, '已修复域名解析') }),
    }
  }

  async deleteHostname(
    providerId: string,
    zoneName: string,
    hostnameFqdn: string,
    autoCleanup = true,
    options: SaaSDeleteOptions = {}
  ): Promise<Record<string, unknown>> {
    let recipe = options.cleanup ?? null
    if (autoCleanup && !recipe) {
      recipe = await this.sync.collect(providerId, zoneName, hostnameFqdn)
      await options.onCleanupPrepared?.(recipe)
    }

    let result: Record<string, unknown> = { id: '', hostname: hostnameFqdn }
    if (!options.primaryDeleted) {
      try {
        result = await this.hostnames.deleteHostname(providerId, zoneName, hostnameFqdn)
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'saas_hostname_not_found')) throw error
      }
      await options.onPrimaryDeleted?.()
    }
    await this.invalidateZone(providerId, zoneName, options.deferListInvalidation)

    if (!autoCleanup || !recipe?.hostname_fqdn || recipe.records.length === 0) return result
    const cleanup = await this.sync.cleanup(providerId, zoneName, recipe.hostname_fqdn, recipe.records)
    return {
      ...result,
      side_effects: buildDnsSideEffects({ cleanup: toCleanupSideEffect(cleanup, '已执行 DNS 删除后清理') }),
    }
  }

  /** 缓存失效失败不影响已完成的远端变更 */
  private async invalidateZone(providerId: string, zoneName: string, deferList = false): Promise<void> {
    try {
      this.invalidateHostnameCache(await this.hostnames.resolveZoneRef(providerId, zoneName), deferList)
    } catch {
      // 尽力而为
    }
  }

  /** 批量任务逐条只清详情缓存；非批量（或任务收尾）清列表 + 详情 */
  private invalidateHostnameCache(owner: { cloudflareProviderId: string; zoneId: string }, deferList = false): void {
    if (deferList) invalidateSaaSHostnameDetailsCache(owner.cloudflareProviderId, owner.zoneId)
    else invalidateSaaSHostnameCache(owner.cloudflareProviderId, owner.zoneId, true)
  }

  private async shouldCleanupOwnershipTxt(providerId: string, hostname: CloudflareCustomHostname) {
    if (!isHostnameActive(hostname) || !hostname.id) return false
    const cfId = await this.hostnames.cloudflareProviderId(providerId)
    return !(await this.preferences.ownershipTxtCleaned(cfId, hostname.id))
  }
}

function hasLocalError(result: Record<string, unknown>): boolean {
  return String(result.local_preference_error ?? '') !== ''
}

/** 本地偏好保存失败转为 side_effects.local */
function presentMutation(result: Record<string, unknown>): Record<string, unknown> {
  const { local_preference_error: localError, ...data } = result
  if (!localError) return data
  return {
    ...data,
    side_effects: {
      local: { preference: { status: 'failed', message: String(localError), details: [] } },
    } satisfies SideEffects,
  }
}

function withDnsEffects(result: Record<string, unknown>, dns: NonNullable<SideEffects['dns']>) {
  const presented = presentMutation(result)
  const existing = (presented.side_effects ?? {}) as SideEffects
  return { ...presented, side_effects: { ...existing, dns: { ...existing.dns, ...dns } } }
}
