import { ApiError } from '../../shared/http/api-error.js'
import type { JobRecord } from '../../platform/jobs/job.types.js'
import type { JobService } from '../../platform/jobs/job.service.js'
import {
  type BatchJobViewBase,
  dedupeStrings,
  findActiveBatchJob,
  finishBatchJob,
  presentBatchJobBase,
  requeueFailedBatchItems,
  runBatchItems,
} from '../../platform/jobs/batch-helpers.js'
import { invalidateSaaSHostnameCache } from '../../modules/saas/saas.cache.js'
import { SAAS_BATCH_DELETE_JOB, SAAS_BATCH_UPDATE_JOB, SAAS_ZONE_JOB_TYPES } from './saas-dns-sync-job.types.js'
import { SaaSHostnameService } from '../../modules/saas/saas-hostname.service.js'
import { SaaSDnsSyncWorkflow, type SaaSDeleteCleanupRecipe } from './saas-dns-sync.workflow.js'

export type SaaSBatchJobView = BatchJobViewBase & {
  provider_id: string
  zone_name: string
}

/**
 * Generic SaaS hostname batch operations on JobService.
 * - batch delete hostnames
 * - batch update fields (currently preferred_domain / auto_preferred / origin)
 */
export class SaaSBatchJobWorkflow {
  constructor(
    private readonly jobs: JobService,
    private readonly workflow: SaaSDnsSyncWorkflow,
    private readonly hostnames: SaaSHostnameService
  ) {
    this.jobs.registerRunner(SAAS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
    this.jobs.registerRunner(SAAS_BATCH_UPDATE_JOB, (job) => this.runUpdate(job))
  }

  async createDelete(input: {
    providerId: string
    zoneName: string
    hostnames: string[]
    autoCleanup?: boolean
  }): Promise<SaaSBatchJobView> {
    const hostnames = dedupeStrings(input.hostnames)
    if (!hostnames.length) throw new ApiError('batch_empty', 'No hostnames selected', 422)

    const job = await this.jobs.createExclusive(
      SAAS_BATCH_DELETE_JOB,
      {
        provider_id: input.providerId,
        zone_name: input.zoneName,
        auto_cleanup: input.autoCleanup !== false,
      },
      hostnames.map((hostname) => ({
        hostname,
        status: 'pending',
        primary_deleted: false,
        dns_cleanup_status: input.autoCleanup === false ? 'not_required' : 'pending',
      })),
      { types: [...SAAS_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone_name: input.zoneName } },
      { message: '批量删除任务已创建' }
    )
    return this.present(job)
  }

  async createUpdate(input: {
    providerId: string
    zoneName: string
    hostnames: string[]
    patch: Record<string, unknown>
    autoSync?: boolean
  }): Promise<SaaSBatchJobView> {
    const hostnames = dedupeStrings(input.hostnames)
    if (!hostnames.length) throw new ApiError('batch_empty', 'No hostnames selected', 422)

    const patch = this.normalizePatch(input.patch)
    if (!Object.keys(patch).length) {
      throw new ApiError('batch_patch_empty', 'No fields to update', 422)
    }

    const job = await this.jobs.createExclusive(
      SAAS_BATCH_UPDATE_JOB,
      {
        provider_id: input.providerId,
        zone_name: input.zoneName,
        patch,
        auto_sync: input.autoSync !== false,
      },
      hostnames.map((hostname) => ({ hostname, status: 'pending' })),
      { types: [...SAAS_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone_name: input.zoneName } },
      { message: '批量修改任务已创建' }
    )
    return this.present(job)
  }

  async find(id: string): Promise<SaaSBatchJobView | null> {
    const job = await this.jobs.get(id)
    if (!job) return null
    if (job.type !== SAAS_BATCH_DELETE_JOB && job.type !== SAAS_BATCH_UPDATE_JOB) return null
    return this.present(job)
  }

  async active(providerId: string, zoneName: string): Promise<SaaSBatchJobView | null> {
    return this.findActive(providerId, zoneName)
  }

  async retryFailed(jobId: string): Promise<SaaSBatchJobView> {
    await this.require(jobId)
    const raw = await this.jobs.get(jobId)
    if (!raw) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: jobId })
    const payload = raw.payload || {}
    const requeued = await requeueFailedBatchItems(this.jobs, raw, {
      types: [...SAAS_ZONE_JOB_TYPES],
      scope: { provider_id: String(payload.provider_id || ''), zone_name: String(payload.zone_name || '') },
    })
    return this.present(requeued)
  }

  private async runDelete(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneName = String(payload.zone_name || '')
    const autoCleanup = payload.auto_cleanup !== false

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.hostname || ''),
      runningMessage: '删除中',
      progressMessage: '批量删除执行中',
      execute: async (item, hostname) => {
        const primaryDeleted = item.primary_deleted === true
        let cleanupRecipe = this.cleanupRecipe(item.cleanup_recipe)
        const result = await this.workflow.deleteHostname(providerId, zoneName, hostname, autoCleanup, {
          primaryDeleted,
          cleanup: cleanupRecipe,
          onCleanupPrepared: cleanupRecipe
            ? undefined
            : async (recipe) => {
                cleanupRecipe = recipe
                await this.persistDeleteStage(job.id, hostname, { cleanup_recipe: recipe })
              },
          onPrimaryDeleted: primaryDeleted
            ? undefined
            : async () => {
                await this.persistDeleteStage(job.id, hostname, { primary_deleted: true })
              },
        })
        const cleanup = (result as { side_effects?: { dns?: { cleanup?: { status?: string; message?: string } } } })
          ?.side_effects?.dns?.cleanup
        if (autoCleanup && cleanup?.status === 'failed') {
          return {
            status: 'failed',
            message: `主机名已删除，但 DNS 清理失败：${cleanup.message || '未知错误'}`,
            extra: {
              primary_deleted: true,
              cleanup_recipe: cleanupRecipe ?? item.cleanup_recipe,
              dns_cleanup_status: 'failed',
            },
          }
        }
        const message = !autoCleanup
          ? '已删除'
          : cleanup?.status === 'completed'
            ? '已删除（DNS 已清理）'
            : cleanup?.status === 'skipped'
              ? `已删除（DNS 跳过：${cleanup.message || '已跳过'}）`
              : '已删除（无 DNS 记录需清理）'
        return {
          status: 'success',
          message,
          extra: {
            primary_deleted: true,
            cleanup_recipe: cleanupRecipe ?? item.cleanup_recipe,
            dns_cleanup_status: autoCleanup ? cleanup?.status || 'none' : 'not_required',
          },
        }
      },
    })

    await finishBatchJob(this.jobs, job.id, '批量删除')
    await this.invalidateZoneCache(providerId, zoneName)
  }

  private async runUpdate(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneName = String(payload.zone_name || '')
    const patch = (payload.patch || {}) as Record<string, unknown>
    const autoSync = payload.auto_sync !== false

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.hostname || ''),
      runningMessage: '更新中',
      progressMessage: '批量修改执行中',
      execute: async (_item, hostname) => {
        const updated = await this.workflow.updateHostname(providerId, zoneName, hostname, patch, autoSync)

        if (autoSync) {
          const dnsSync = (updated as { side_effects?: { dns?: { sync?: { status?: string; message?: string } } } })
            ?.side_effects?.dns?.sync
          if (dnsSync?.status === 'failed') {
            return {
              status: 'failed',
              message: `配置已更新，但 DNS 写回失败：${dnsSync.message || '未知错误'}`,
              extra: { dns_sync_status: 'failed' },
            }
          }
          const dnsNote =
            dnsSync?.status === 'skipped'
              ? `（DNS 跳过：${dnsSync.message || '已跳过'}）`
              : dnsSync?.status === 'completed'
                ? '（DNS 已写回）'
                : ''
          return {
            status: 'success',
            message: `已更新${dnsNote}`,
            extra: { dns_sync_status: dnsSync?.status || 'unknown' },
          }
        }

        return { status: 'success', message: '已更新' }
      },
    })

    await finishBatchJob(this.jobs, job.id, '批量修改')
    await this.invalidateZoneCache(providerId, zoneName)
  }

  private cleanupRecipe(value: unknown): SaaSDeleteCleanupRecipe | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const recipe = value as Record<string, unknown>
    const hostnameFqdn = String(recipe.hostname_fqdn ?? '').trim()
    if (hostnameFqdn === '' || !Array.isArray(recipe.records)) return undefined
    return { hostname_fqdn: hostnameFqdn, records: recipe.records as SaaSDeleteCleanupRecipe['records'] }
  }

  private async persistDeleteStage(jobId: string, hostname: string, patch: Record<string, unknown>): Promise<void> {
    await this.jobs.patchItem(jobId, (row) => String(row.hostname || '') === hostname, patch)
    // Flush the durable stage marker before starting the next external side effect.
    await this.jobs.get(jobId)
  }

  private async invalidateZoneCache(providerId: string, zoneName: string): Promise<void> {
    try {
      const zone = await this.hostnames.resolveZoneRef(providerId, zoneName)
      invalidateSaaSHostnameCache(zone.cloudflareProviderId, zone.zoneId, false)
    } catch {
      // Best-effort cache invalidation after a durable provider mutation.
    }
  }

  private normalizePatch(patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if ('preferred_domain' in patch) out.preferred_domain = String(patch.preferred_domain ?? '').trim()
    if ('auto_preferred' in patch) out.auto_preferred = Boolean(patch.auto_preferred)
    if ('custom_origin_server' in patch) out.custom_origin_server = String(patch.custom_origin_server ?? '').trim()
    if ('method' in patch) out.method = String(patch.method ?? '').trim()
    if ('min_tls_version' in patch) out.min_tls_version = String(patch.min_tls_version ?? '').trim()
    return out
  }

  /** Any SaaS batch / preferred-apply job for the same zone blocks new work. */
  private async findActive(providerId: string, zoneName: string): Promise<SaaSBatchJobView | null> {
    const hit = await findActiveBatchJob(this.jobs, [...SAAS_ZONE_JOB_TYPES], {
      provider_id: providerId,
      zone_name: zoneName,
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<SaaSBatchJobView> {
    const job = await this.find(id)
    if (!job) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): SaaSBatchJobView {
    const base = presentBatchJobBase(job)
    const payload = job.payload || {}
    return {
      ...base,
      provider_id: String(payload.provider_id || ''),
      zone_name: String(payload.zone_name || ''),
    }
  }
}
