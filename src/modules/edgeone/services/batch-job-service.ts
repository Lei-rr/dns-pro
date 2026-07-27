import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../platform/job/types.js'
import type { JobService } from '../../../platform/job/job-service.js'
import {
  EDGEONE_BATCH_DELETE_JOB,
  EDGEONE_BATCH_DISABLE_JOB,
  EDGEONE_ZONE_JOB_TYPES,
} from '../job-types.js'
import { emitEdgeDomainMutated } from '../events.js'
import {
  assertNoActiveBatchJob,
  dedupeStrings,
  findActiveBatchJob,
  finishBatchJob,
  presentBatchJobBase,
  requeueFailedBatchItems,
  runBatchItems,
} from '../../../platform/job/batch-helpers.js'
import type { EdgeOneDomainService } from './domain-service.js'
import type { EdgeOneWorkflowService } from './workflow-service.js'

export type EdgeOneBatchJobView = {
  id: string
  type: string
  provider_id: string
  zone_id: string
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
 * EdgeOne acceleration-domain batch operations on JobService.
 */
export class EdgeOneBatchJobService {
  constructor(
    private readonly jobs: JobService,
    private readonly domains: EdgeOneDomainService,
    private readonly workflow: EdgeOneWorkflowService,
  ) {
    this.jobs.registerRunner(EDGEONE_BATCH_DISABLE_JOB, (job) => this.runDisable(job))
    this.jobs.registerRunner(EDGEONE_BATCH_DELETE_JOB, (job) => this.runDelete(job))
  }

  async createDisable(input: {
    providerId: string
    zoneId: string
    domains: string[]
  }): Promise<EdgeOneBatchJobView> {
    const domains = dedupeStrings(input.domains)
    if (!domains.length) throw new ApiError('batch_empty', 'No domains selected', 422)

    await assertNoActiveBatchJob(this.jobs, [...EDGEONE_ZONE_JOB_TYPES], {
      provider_id: input.providerId,
      zone_id: input.zoneId,
    })

    const job = await this.jobs.create(
      EDGEONE_BATCH_DISABLE_JOB,
      {
        provider_id: input.providerId,
        zone_id: input.zoneId,
        status: 'offline',
      },
      domains.map((domain) => ({ domain, status: 'pending' })),
      { message: '批量停用任务已创建' },
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

    await assertNoActiveBatchJob(this.jobs, [...EDGEONE_ZONE_JOB_TYPES], {
      provider_id: input.providerId,
      zone_id: input.zoneId,
    })

    const job = await this.jobs.create(
      EDGEONE_BATCH_DELETE_JOB,
      {
        provider_id: input.providerId,
        zone_id: input.zoneId,
        auto_cleanup: input.autoCleanup !== false,
      },
      domains.map((domain) => ({ domain, status: 'pending' })),
      { message: '批量删除任务已创建' },
    )
    return this.present(job)
  }

  async find(id: string): Promise<EdgeOneBatchJobView | null> {
    const job = await this.jobs.get(id)
    if (!job) return null
    if (job.type !== EDGEONE_BATCH_DISABLE_JOB && job.type !== EDGEONE_BATCH_DELETE_JOB) return null
    return this.present(job)
  }

  async active(providerId: string, zoneId: string): Promise<EdgeOneBatchJobView | null> {
    return this.findActive(providerId, zoneId)
  }

  async retryFailed(jobId: string): Promise<EdgeOneBatchJobView> {
    await this.require(jobId)
    const raw = await this.jobs.get(jobId)
    if (!raw) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: jobId })
    const requeued = await requeueFailedBatchItems(this.jobs, raw)
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
    await emitEdgeDomainMutated({
      providerId,
      zoneId,
      action: 'batch_disable',
    })
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
      execute: async (_item, domain) => {
        const result = await this.workflow.deleteAccelerationDomain(providerId, zoneId, domain, autoCleanup)
        const cleanup = (
          result as { side_effects?: { dns?: { cleanup?: { status?: string; message?: string } } } }
        )?.side_effects?.dns?.cleanup
        if (autoCleanup && cleanup?.status === 'failed') {
          return {
            status: 'failed',
            message: `加速域名已删除，但 DNS 清理失败：${cleanup.message || '未知错误'}`,
            extra: { dns_cleanup_status: 'failed' },
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
          extra: { dns_cleanup_status: cleanup?.status },
        }
      },
    })

    await finishBatchJob(this.jobs, job.id, '批量删除')
    await emitEdgeDomainMutated({
      providerId,
      zoneId,
      action: 'batch_delete',
    })
  }

  private async findActive(providerId: string, zoneId: string): Promise<EdgeOneBatchJobView | null> {
    const hit = await findActiveBatchJob(this.jobs, [...EDGEONE_ZONE_JOB_TYPES], {
      provider_id: providerId,
      zone_id: zoneId,
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<EdgeOneBatchJobView> {
    const job = await this.find(id)
    if (!job) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    return job
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
