import { ApiError } from '../../kernel/http/api-error.js'
import type { JobService } from '../../kernel/jobs/job.service.js'
import type { JobRecord } from '../../kernel/jobs/job.types.js'
import {
  BatchJobKind,
  dedupeStrings,
  dnsEffectNote,
  dnsEffectOf,
  finishBatchJob,
  persistItemStage,
  runBatchItems,
  type BatchJobViewBase,
} from '../../kernel/jobs/batch-job.js'
import type { SaaSHostnameService } from '../../domains/cloudflare/saas/saas-hostname.service.js'
import { invalidateSaaSHostnameCache } from '../../domains/cloudflare/saas/saas.cache.js'
import {
  SAAS_BATCH_DELETE_JOB,
  SAAS_BATCH_UPDATE_JOB,
  SAAS_ZONE_LOCK_MESSAGE,
  ZONE_WRITE_JOB_TYPES,
  readResourceKeys,
} from '../../kernel/jobs/job-types.js'
import type { SaaSDeleteCleanupRecipe, SaaSDnsSyncWorkflow } from './saas-dns-sync.workflow.js'
import type { SyncRecord } from './saas-sync-records.js'

type SaaSBatchJobView = BatchJobViewBase & { provider_id: string; zone_name: string }
type ZoneScope = { providerId: string; zoneName: string }

// 批量修改允许的字段
const PATCH_STRING_FIELDS = ['preferred_domain', 'custom_origin_server', 'method', 'min_tls_version'] as const

const byHostname = (hostname: string) => (row: Record<string, unknown>) => String(row.hostname ?? '') === hostname

/** SaaS 主机名批量 删除/修改；与优选应用共用站点互斥锁 */
export class SaaSBatchWorkflow {
  private readonly kind: BatchJobKind<SaaSBatchJobView>

  constructor(
    private readonly jobs: JobService,
    private readonly workflow: SaaSDnsSyncWorkflow,
    private readonly hostnames: SaaSHostnameService
  ) {
    this.kind = new BatchJobKind(jobs, {
      types: [SAAS_BATCH_DELETE_JOB, SAAS_BATCH_UPDATE_JOB],
      lockTypes: ZONE_WRITE_JOB_TYPES,
      scopeKeys: ['provider_id', 'zone_name'],
      resourceKeys: readResourceKeys,
      lockMessage: SAAS_ZONE_LOCK_MESSAGE,
      present: (job, base) => ({
        ...base,
        provider_id: String(job.payload.provider_id ?? ''),
        zone_name: String(job.payload.zone_name ?? ''),
      }),
    })
    jobs.registerRunner(SAAS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
    jobs.registerRunner(SAAS_BATCH_UPDATE_JOB, (job) => this.runUpdate(job))
  }

  createDelete(input: ZoneScope & { hostnames: string[]; autoCleanup?: boolean }) {
    const autoCleanup = input.autoCleanup !== false
    const items = this.items(input.hostnames, {
      primary_deleted: false,
      dns_cleanup_status: autoCleanup ? 'pending' : 'not_required',
    })
    return this.enqueue(SAAS_BATCH_DELETE_JOB, input, { auto_cleanup: autoCleanup }, items, '批量删除任务已创建')
  }

  createUpdate(input: ZoneScope & { hostnames: string[]; patch: Record<string, unknown>; autoSync?: boolean }) {
    const items = this.items(input.hostnames, { primary_applied: false })
    const patch = normalizePatch(input.patch)
    if (!Object.keys(patch).length) throw new ApiError('batch_patch_empty', 'No fields to update', 422)
    return this.enqueue(
      SAAS_BATCH_UPDATE_JOB,
      input,
      { patch, auto_sync: input.autoSync !== false },
      items,
      '批量修改任务已创建'
    )
  }

  find(id: string, providerId?: string) {
    return this.kind.find(id, { provider_id: providerId })
  }

  active(providerId: string, zoneName: string) {
    return this.kind.active({ provider_id: providerId, zone_name: zoneName })
  }

  retryFailed(id: string, providerId?: string) {
    return this.kind.retryFailed(id, { provider_id: providerId })
  }

  private items(hostnames: string[], extra: Record<string, unknown>) {
    const unique = dedupeStrings(hostnames)
    if (!unique.length) throw new ApiError('batch_empty', 'No hostnames selected', 422)
    return unique.map((hostname) => ({ hostname, ...extra }))
  }

  private async enqueue(
    type: string,
    scope: ZoneScope,
    extra: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    message: string
  ) {
    const payload = {
      provider_id: scope.providerId,
      zone_name: scope.zoneName,
      resource_keys: await this.workflow.resourceKeys(scope.providerId, scope.zoneName),
      ...extra,
    }
    return this.kind.present(
      await this.jobs.createExclusive(type, payload, items, this.kind.lock(payload), { message })
    )
  }

  /** 分阶段删除：清理配方 → 删除主机名 → 清理 DNS；每阶段落盘后才进入下一阶段 */
  private async runDelete(job: JobRecord): Promise<void> {
    const { providerId, zoneName } = scopeOf(job)
    const autoCleanup = job.payload.auto_cleanup !== false
    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.hostname ?? ''),
      runningMessage: '删除中',
      progressMessage: '批量删除执行中',
      execute: async (item, hostname) => {
        const primaryDeleted = item.primary_deleted === true
        let recipe = cleanupRecipeOf(item.cleanup_recipe)
        const stage = (patch: Record<string, unknown>) =>
          persistItemStage(this.jobs, job.id, byHostname(hostname), patch)
        const result = await this.workflow.deleteHostname(providerId, zoneName, hostname, autoCleanup, {
          primaryDeleted,
          deferListInvalidation: true,
          cleanup: recipe,
          onCleanupPrepared: recipe
            ? undefined
            : async (prepared) => {
                recipe = prepared
                await stage({ cleanup_recipe: prepared })
              },
          onPrimaryDeleted: primaryDeleted ? undefined : () => stage({ primary_deleted: true }),
        })
        const cleanup = dnsEffectOf(result, 'cleanup')
        const extra = { primary_deleted: true, cleanup_recipe: recipe ?? item.cleanup_recipe }
        if (autoCleanup && cleanup?.status === 'failed') {
          return {
            status: 'failed',
            message: `主机名已删除，但 DNS 清理失败：${cleanup.message || '未知错误'}`,
            extra: { ...extra, dns_cleanup_status: 'failed' },
          }
        }
        const note = !autoCleanup ? '' : cleanup ? dnsEffectNote(cleanup, 'DNS 已清理') : '（无 DNS 记录需清理）'
        return {
          status: 'success',
          message: `已删除${note}`,
          // 取值与 EdgeOne 保持一致：completed | skipped | failed | not_required
          extra: { ...extra, dns_cleanup_status: autoCleanup ? (cleanup?.status ?? 'skipped') : 'not_required' },
        }
      },
    })
    await finishBatchJob(this.jobs, job.id, '批量删除')
    await this.invalidateZoneCache(providerId, zoneName)
  }

  /** 修改前保存 DNS 快照并落盘，重试时远端已应用则不重复 PATCH */
  private async runUpdate(job: JobRecord): Promise<void> {
    const { providerId, zoneName } = scopeOf(job)
    const autoSync = job.payload.auto_sync !== false
    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.hostname ?? ''),
      runningMessage: '更新中',
      progressMessage: '批量修改执行中',
      execute: async (item, hostname) => {
        const beforeRecords = Array.isArray(item.dns_before_records)
          ? (item.dns_before_records as SyncRecord[])
          : undefined
        // 补丁对象每条目复制一份，防止下游修改污染后续条目
        const patch = { ...(job.payload.patch as Record<string, unknown>) }
        const updated = await this.workflow.updateHostname(providerId, zoneName, hostname, patch, autoSync, {
          remoteApplied: item.primary_applied === true,
          deferListInvalidation: true,
          beforeRecords,
          onBeforeRecordsPrepared: beforeRecords
            ? undefined
            : (records) => persistItemStage(this.jobs, job.id, byHostname(hostname), { dns_before_records: records }),
        })

        const local = (updated as { side_effects?: { local?: { preference?: { status?: string; message?: string } } } })
          .side_effects?.local?.preference
        if (local?.status === 'failed') {
          return {
            status: 'failed',
            message: `远端配置已更新，但本地偏好保存失败：${local.message || '未知错误'}`,
            extra: { primary_applied: true, local_preference_status: 'failed' },
          }
        }
        if (!autoSync) return { status: 'success', message: '已更新', extra: { primary_applied: true } }

        const sync = dnsEffectOf(updated, 'sync')
        if (sync?.status === 'failed') {
          return {
            status: 'failed',
            message: `配置已更新，但 DNS 写回失败：${sync.message || '未知错误'}`,
            extra: { primary_applied: true, dns_sync_status: 'failed' },
          }
        }
        return {
          status: 'success',
          message: `已更新${dnsEffectNote(sync, 'DNS 已写回')}`,
          extra: { primary_applied: true, dns_sync_status: sync?.status ?? 'unknown' },
        }
      },
    })
    await finishBatchJob(this.jobs, job.id, '批量修改')
    await this.invalidateZoneCache(providerId, zoneName)
  }

  private async invalidateZoneCache(providerId: string, zoneName: string): Promise<void> {
    try {
      const zone = await this.hostnames.resolveZoneRef(providerId, zoneName)
      invalidateSaaSHostnameCache(zone.cloudflareProviderId, zone.zoneId, true)
    } catch {
      // 远端变更已完成，缓存失效尽力而为
    }
  }
}

function scopeOf(job: JobRecord): ZoneScope {
  return { providerId: String(job.payload.provider_id ?? ''), zoneName: String(job.payload.zone_name ?? '') }
}

function normalizePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of PATCH_STRING_FIELDS) if (field in patch) out[field] = String(patch[field] ?? '').trim()
  if ('auto_preferred' in patch) out.auto_preferred = Boolean(patch.auto_preferred)
  return out
}

function cleanupRecipeOf(value: unknown): SaaSDeleteCleanupRecipe | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const recipe = value as Record<string, unknown>
  const fqdn = String(recipe.hostname_fqdn ?? '').trim()
  return fqdn && Array.isArray(recipe.records)
    ? { hostname_fqdn: fqdn, records: recipe.records as SyncRecord[] }
    : undefined
}
