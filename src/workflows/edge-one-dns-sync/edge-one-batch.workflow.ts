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
import { ApiError } from '../../shared/http/api-error.js'
import { EdgeOneDomainService } from '../../modules/edge-one/edge-one-domain.service.js'
import { invalidateEdgeOneDomainCache } from '../../modules/edge-one/edge-one.cache.js'
import {
  EDGEONE_BATCH_DELETE_JOB,
  EDGEONE_BATCH_DISABLE_JOB,
  EDGEONE_ZONE_JOB_TYPES,
} from './edge-one-dns-sync-job.types.js'
import { EdgeOneDnsSyncWorkflow } from './edge-one-dns-sync.workflow.js'

export type EdgeOneBatchJobView = BatchJobViewBase & {
  provider_id: string
  zone_id: string
}

/** EdgeOne acceleration-domain batch operations on JobService. */
export class EdgeOneBatchJobWorkflow {
  constructor(
    private readonly jobs: JobService,
    private readonly domains: EdgeOneDomainService,
    private readonly dnsSync: EdgeOneDnsSyncWorkflow
  ) {
    this.jobs.registerRunner(EDGEONE_BATCH_DISABLE_JOB, (job) => this.runDisable(job))
    this.jobs.registerRunner(EDGEONE_BATCH_DELETE_JOB, (job) => this.runDelete(job))
  }

  async createDisable(input: { providerId: string; zoneId: string; domains: string[] }): Promise<EdgeOneBatchJobView> {
    const domains = dedupeStrings(input.domains)
    if (!domains.length) throw new ApiError('batch_empty', 'No domains selected', 422)

    const job = await this.jobs.createExclusive(
      EDGEONE_BATCH_DISABLE_JOB,
      { provider_id: input.providerId, zone_id: input.zoneId, status: 'offline' },
      domains.map((domain) => ({ domain, status: 'pending' })),
      { types: [...EDGEONE_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone_id: input.zoneId } },
      { message: '批量停用任务已创建' }
    )
    return this.present(job)
  }

  async createDelete(input: {
    providerId: string
    zoneId: string
    domains: string[]
    autoCleanup?: boolean
  }): Promise<EdgeOneBatchJobView> {
    const domains = dedupeStrings(input.domains)
    if (!domains.length) throw new ApiError('batch_empty', 'No domains selected', 422)

    const job = await this.jobs.createExclusive(
      EDGEONE_BATCH_DELETE_JOB,
      {
        provider_id: input.providerId,
        zone_id: input.zoneId,
        auto_cleanup: input.autoCleanup !== false,
      },
      domains.map((domain) => ({
        domain,
        status: 'pending',
        primary_deleted: false,
        dns_cleanup_status: input.autoCleanup === false ? 'not_required' : 'pending',
      })),
      { types: [...EDGEONE_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone_id: input.zoneId } },
      { message: '批量删除任务已创建' }
    )
    return this.present(job)
  }

  async find(id: string, providerId?: string): Promise<EdgeOneBatchJobView | null> {
    const job = await this.jobs.get(id)
    if (!job) return null
    if (job.type !== EDGEONE_BATCH_DISABLE_JOB && job.type !== EDGEONE_BATCH_DELETE_JOB) return null
    if (providerId !== undefined && String(job.payload?.provider_id ?? '') !== providerId) return null
    return this.present(job)
  }

  async active(providerId: string, zoneId: string): Promise<EdgeOneBatchJobView | null> {
    const hit = await findActiveBatchJob(this.jobs, [...EDGEONE_ZONE_JOB_TYPES], {
      provider_id: providerId,
      zone_id: zoneId,
    })
    return hit ? this.present(hit) : null
  }

  async retryFailed(jobId: string, providerId?: string): Promise<EdgeOneBatchJobView> {
    const existing = await this.find(jobId, providerId)
    if (!existing) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: jobId })
    const raw = await this.jobs.get(jobId)
    if (!raw) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: jobId })
    const payload = raw.payload || {}
    const requeued = await requeueFailedBatchItems(this.jobs, raw, {
      types: [...EDGEONE_ZONE_JOB_TYPES],
      scope: { provider_id: String(payload.provider_id || ''), zone_id: String(payload.zone_id || '') },
    })
    return this.present(requeued)
  }

  private async runDisable(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneId = String(payload.zone_id || '')
    const status = String(payload.status || 'offline')

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.domain || ''),
      runningMessage: '停用中',
      progressMessage: '批量停用执行中',
      execute: async (_item, domain) => {
        await this.domains.updateAccelerationDomainStatus(providerId, zoneId, domain, status)
        return { status: 'success', message: '已停用' }
      },
    })

    await finishBatchJob(this.jobs, job.id, '批量停用')
    invalidateEdgeOneDomainCache(providerId, zoneId)
  }

  private async runDelete(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneId = String(payload.zone_id || '')
    const autoCleanup = payload.auto_cleanup !== false

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.domain || ''),
      runningMessage: '删除中',
      progressMessage: '批量删除执行中',
      execute: async (item, domain) => {
        const primaryDeleted = item.primary_deleted === true
        const result = await this.dnsSync.deleteAccelerationDomain(providerId, zoneId, domain, autoCleanup, {
          primaryDeleted,
          onPrimaryDeleted: primaryDeleted
            ? undefined
            : async () => {
                await this.jobs.patchItem(job.id, (row) => String(row.domain || '') === domain, {
                  primary_deleted: true,
                })
                // Persist the completed primary stage before starting DNS cleanup.
                await this.jobs.get(job.id)
              },
        })
        const cleanup = (result as { side_effects?: { dns?: { cleanup?: { status?: string; message?: string } } } })
          .side_effects?.dns?.cleanup
        if (autoCleanup && cleanup?.status === 'failed') {
          return {
            status: 'failed',
            message: `加速域名已删除，但 DNS 清理失败：${cleanup.message || '未知错误'}`,
            extra: { primary_deleted: true, dns_cleanup_status: 'failed' },
          }
        }
        const note =
          autoCleanup && cleanup?.status === 'completed'
            ? '已删除（DNS 已清理）'
            : autoCleanup && cleanup?.status === 'skipped'
              ? `已删除（DNS 跳过：${cleanup.message || '—'}）`
              : '已删除'
        return {
          status: 'success',
          message: note,
          extra: {
            primary_deleted: true,
            dns_cleanup_status: autoCleanup ? (cleanup?.status ?? 'skipped') : 'not_required',
          },
        }
      },
    })

    await finishBatchJob(this.jobs, job.id, '批量删除')
    invalidateEdgeOneDomainCache(providerId, zoneId)
  }

  private present(job: JobRecord): EdgeOneBatchJobView {
    const base = presentBatchJobBase(job)
    const payload = job.payload || {}
    return {
      ...base,
      provider_id: String(payload.provider_id || ''),
      zone_id: String(payload.zone_id || ''),
    }
  }
}
