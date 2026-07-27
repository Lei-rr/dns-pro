import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../platform/job/types.js'
import type { JobService } from '../../../platform/job/job-service.js'
import {
  assertNoActiveBatchJob,
  dedupeStrings,
  findActiveBatchJob,
  finishBatchJob,
  presentBatchJobBase,
  requeueFailedBatchItems,
  runBatchItems,
} from '../../../platform/job/batch-helpers.js'
import { emitSaasHostnameMutated } from '../events.js'
import {
  SAAS_BATCH_DELETE_JOB,
  SAAS_BATCH_UPDATE_JOB,
  SAAS_ZONE_JOB_TYPES,
} from '../job-types.js'
import { SaasHostnameService } from './hostname-service.js'
import { SaasWorkflowService } from './workflow-service.js'

export type SaasBatchJobView = {
  id: string
  type: string
  provider_id: string
  zone_name: string
  status: string
  total: number
  done: number
  success: number
  failed: number
  skipped: number
  current?: string
  message?: string
  payload?: Record<string, unknown>
  items: Array<Record<string, unknown>>
  created_at: number
  updated_at: number
  finished_at?: number
}

/**
 * Generic SaaS hostname batch operations on JobService.
 * - batch delete hostnames
 * - batch update fields (currently preferred_domain / auto_preferred / origin)
 */
export class SaasBatchJobService {
  constructor(
    private readonly jobs: JobService,
    private readonly workflow: SaasWorkflowService,
    private readonly hostnames: SaasHostnameService,
  ) {
    this.jobs.registerRunner(SAAS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
    this.jobs.registerRunner(SAAS_BATCH_UPDATE_JOB, (job) => this.runUpdate(job))
  }

  async createDelete(input: {
    providerId: string
    zoneName: string
    hostnames: string[]
    autoCleanup?: boolean
  }): Promise<SaasBatchJobView> {
    const hostnames = dedupeStrings(input.hostnames)
    if (!hostnames.length) throw new ApiError('batch_empty', 'No hostnames selected', 422)

    await assertNoActiveBatchJob(this.jobs, [...SAAS_ZONE_JOB_TYPES], {
      provider_id: input.providerId,
      zone_name: input.zoneName,
    })

    const job = await this.jobs.create(
      SAAS_BATCH_DELETE_JOB,
      {
        provider_id: input.providerId,
        zone_name: input.zoneName,
        auto_cleanup: input.autoCleanup !== false,
      },
      hostnames.map((hostname) => ({ hostname, status: 'pending' })),
      { message: '批量删除任务已创建' },
    )
    return this.present(job)
  }

  async createUpdate(input: {
    providerId: string
    zoneName: string
    hostnames: string[]
    patch: Record<string, unknown>
    autoSync?: boolean
  }): Promise<SaasBatchJobView> {
    const hostnames = dedupeStrings(input.hostnames)
    if (!hostnames.length) throw new ApiError('batch_empty', 'No hostnames selected', 422)

    const patch = this.normalizePatch(input.patch)
    if (!Object.keys(patch).length) {
      throw new ApiError('batch_patch_empty', 'No fields to update', 422)
    }

    await assertNoActiveBatchJob(this.jobs, [...SAAS_ZONE_JOB_TYPES], {
      provider_id: input.providerId,
      zone_name: input.zoneName,
    })

    const job = await this.jobs.create(
      SAAS_BATCH_UPDATE_JOB,
      {
        provider_id: input.providerId,
        zone_name: input.zoneName,
        patch,
        auto_sync: input.autoSync !== false,
      },
      hostnames.map((hostname) => ({ hostname, status: 'pending' })),
      { message: '批量修改任务已创建' },
    )
    return this.present(job)
  }

  async find(id: string): Promise<SaasBatchJobView | null> {
    const job = await this.jobs.get(id)
    if (!job) return null
    if (job.type !== SAAS_BATCH_DELETE_JOB && job.type !== SAAS_BATCH_UPDATE_JOB) return null
    return this.present(job)
  }

  async active(providerId: string, zoneName: string): Promise<SaasBatchJobView | null> {
    return this.findActive(providerId, zoneName)
  }

  async retryFailed(jobId: string): Promise<SaasBatchJobView> {
    await this.require(jobId)
    const raw = await this.jobs.get(jobId)
    if (!raw) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: jobId })
    const requeued = await requeueFailedBatchItems(this.jobs, raw)
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
      execute: async (_item, hostname) => {
        await this.workflow.deleteHostname(providerId, zoneName, hostname, autoCleanup)
        return {
          status: 'success',
          message: autoCleanup ? '已删除（含 DNS 清理）' : '已删除',
        }
      },
    })

    await finishBatchJob(this.jobs, job.id, '批量删除')
    await this.emitZoneMutated(providerId, zoneName, 'batch_delete')
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
          const dnsSync = (
            updated as { side_effects?: { dns?: { sync?: { status?: string; message?: string } } } }
          )?.side_effects?.dns?.sync
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
    await this.emitZoneMutated(
      providerId,
      zoneName,
      'batch_update',
      patch.preferred_domain ? String(patch.preferred_domain) : undefined,
    )
  }

  private async emitZoneMutated(
    providerId: string,
    zoneName: string,
    action: string,
    target?: string,
  ): Promise<void> {
    try {
      const zone = await this.hostnames.resolveZoneRef(providerId, zoneName)
      await emitSaasHostnameMutated({
        saasProviderId: providerId,
        cloudflareProviderId: zone.cloudflareProviderId,
        zoneName,
        zoneId: zone.zoneId,
        action,
        target,
      })
    } catch {
      // best-effort cache invalidate
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
  private async findActive(providerId: string, zoneName: string): Promise<SaasBatchJobView | null> {
    const hit = await findActiveBatchJob(this.jobs, [...SAAS_ZONE_JOB_TYPES], {
      provider_id: providerId,
      zone_name: zoneName,
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<SaasBatchJobView> {
    const job = await this.find(id)
    if (!job) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): SaasBatchJobView {
    const base = presentBatchJobBase(job)
    const payload = job.payload || {}
    return {
      ...base,
      provider_id: String(payload.provider_id || ''),
      zone_name: String(payload.zone_name || ''),
    }
  }
}
