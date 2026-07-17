import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../platform/job/types.js'
import type { JobService } from '../../../platform/job/job-service.js'
import { eventBus } from '../../../platform/events/event-bus.js'
import type { EdgeOneDomainService } from './domain-service.js'
import type { EdgeOneWorkflowService } from './workflow-service.js'

export const EDGEONE_BATCH_DISABLE_JOB = 'edgeone.batch_disable'
export const EDGEONE_BATCH_DELETE_JOB = 'edgeone.batch_delete'

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
    const domains = this.normalizeDomains(input.domains)
    if (!domains.length) throw new ApiError('batch_empty', 'No domains selected', 422)

    const active = await this.findActive(input.providerId, input.zoneId)
    if (active) {
      throw new ApiError('batch_job_running', 'A batch job is already running for this zone', 409, {
        job_id: active.id,
      })
    }

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
    const domains = this.normalizeDomains(input.domains)
    if (!domains.length) throw new ApiError('batch_empty', 'No domains selected', 422)

    const active = await this.findActive(input.providerId, input.zoneId)
    if (active) {
      throw new ApiError('batch_job_running', 'A batch job is already running for this zone', 409, {
        job_id: active.id,
      })
    }

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
    const job = await this.require(jobId)
    const failed = job.items.filter((i) => i.status === 'failed')
    if (!failed.length) throw new ApiError('batch_no_failed', 'No failed items to retry', 422)

    const items = job.items.map((item) =>
      item.status === 'failed' ? { ...item, status: 'pending', message: undefined } : item,
    )
    const requeued = await this.jobs.requeue(jobId, {
      items,
      done: items.filter((i) => ['success', 'skipped'].includes(String(i.status))).length,
      failed: 0,
      success: items.filter((i) => i.status === 'success').length,
      skipped: items.filter((i) => i.status === 'skipped').length,
      message: '失败项重试中',
    })
    return this.present(requeued)
  }

  private async runDisable(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneId = String(payload.zone_id || '')
    const status = String(payload.status || 'offline')

    for (const raw of job.items) {
      const item = raw as Record<string, unknown>
      const domain = String(item.domain || '')
      if (!domain || item.status === 'success' || item.status === 'skipped') continue

      await this.jobs.patchItem(
        job.id,
        (row) => String(row.domain || '') === domain,
        { status: 'running', message: '停用中' },
        { current: domain, message: '批量停用执行中' },
      )

      try {
        await this.domains.updateAccelerationDomainStatus(providerId, zoneId, domain, status)
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.domain || '') === domain,
          { status: 'success', message: '已停用' },
        )
      } catch (error) {
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.domain || '') === domain,
          {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    await this.finish(job.id, '批量停用')
    await eventBus.emit({
      type: 'edge.domain.mutated',
      provider_id: providerId,
      zone: zoneId,
      action: 'edgeone.domain.batch_disable',
      cache_tags: [`edgeone:domains:${providerId}:${zoneId}`],
    })
  }

  private async runDelete(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneId = String(payload.zone_id || '')
    const autoCleanup = payload.auto_cleanup !== false

    for (const raw of job.items) {
      const item = raw as Record<string, unknown>
      const domain = String(item.domain || '')
      if (!domain || item.status === 'success' || item.status === 'skipped') continue

      await this.jobs.patchItem(
        job.id,
        (row) => String(row.domain || '') === domain,
        { status: 'running', message: '删除中' },
        { current: domain, message: '批量删除执行中' },
      )

      try {
        await this.workflow.deleteAccelerationDomain(providerId, zoneId, domain, autoCleanup)
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.domain || '') === domain,
          { status: 'success', message: '已删除' },
        )
      } catch (error) {
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.domain || '') === domain,
          {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    await this.finish(job.id, '批量删除')
    await eventBus.emit({
      type: 'edge.domain.mutated',
      provider_id: providerId,
      zone: zoneId,
      action: 'edgeone.domain.batch_delete',
      cache_tags: [`edgeone:domains:${providerId}:${zoneId}`],
    })
  }

  private async finish(jobId: string, label: string): Promise<void> {
    const finalJob = await this.jobs.get(jobId)
    if (!finalJob) return
    const success = finalJob.items.filter((i) => i.status === 'success').length
    const failed = finalJob.items.filter((i) => i.status === 'failed').length
    const skipped = finalJob.items.filter((i) => i.status === 'skipped').length
    await this.jobs.patch(jobId, {
      status: failed > 0 && success === 0 ? 'failed' : 'completed',
      success,
      failed,
      skipped,
      done: finalJob.items.length,
      current: undefined,
      finished_at: Date.now(),
      message: failed
        ? `${label}完成：成功 ${success}，失败 ${failed}，跳过 ${skipped}`
        : `${label}完成：成功 ${success}，跳过 ${skipped}`,
    })
  }

  private normalizeDomains(domains: string[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of domains || []) {
      const domain = String(raw || '').trim().toLowerCase()
      if (!domain || seen.has(domain)) continue
      seen.add(domain)
      out.push(domain)
    }
    return out
  }

  private async findActive(providerId: string, zoneId: string): Promise<EdgeOneBatchJobView | null> {
    const actives = [
      ...(await this.jobs.listActive(EDGEONE_BATCH_DISABLE_JOB)),
      ...(await this.jobs.listActive(EDGEONE_BATCH_DELETE_JOB)),
    ]
    const hit = actives.find((job) => {
      const payload = job.payload || {}
      return payload.provider_id === providerId && payload.zone_id === zoneId
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<EdgeOneBatchJobView> {
    const job = await this.find(id)
    if (!job) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): EdgeOneBatchJobView {
    const payload = job.payload || {}
    return {
      id: job.id,
      type: job.type,
      provider_id: String(payload.provider_id || ''),
      zone_id: String(payload.zone_id || ''),
      status: job.status,
      total: job.total,
      done: job.done,
      success: job.success,
      failed: job.failed,
      skipped: job.skipped,
      current: job.current == null ? undefined : String(job.current),
      message: job.message,
      payload,
      items: job.items,
      created_at: job.created_at,
      updated_at: job.updated_at,
      finished_at: job.finished_at,
    }
  }
}
