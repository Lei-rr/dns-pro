import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../kernel/index.js'
import type { JobService } from '../../../platform/job/job-service.js'
import { eventBus } from '../../../platform/events/event-bus.js'
import { SaasWorkflowService } from './workflow-service.js'

export const SAAS_BATCH_DELETE_JOB = 'saas.batch_delete'
export const SAAS_BATCH_UPDATE_JOB = 'saas.batch_update'

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
    const hostnames = this.normalizeHostnames(input.hostnames)
    if (!hostnames.length) throw new ApiError('batch_empty', 'No hostnames selected', 422)

    const active = await this.findActive(input.providerId, input.zoneName, SAAS_BATCH_DELETE_JOB)
    if (active) {
      throw new ApiError('batch_job_running', 'A batch job is already running for this zone', 409, { job_id: active.id })
    }

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
    const hostnames = this.normalizeHostnames(input.hostnames)
    if (!hostnames.length) throw new ApiError('batch_empty', 'No hostnames selected', 422)

    const patch = this.normalizePatch(input.patch)
    if (!Object.keys(patch).length) {
      throw new ApiError('batch_patch_empty', 'No fields to update', 422)
    }

    const active = await this.findActive(input.providerId, input.zoneName, SAAS_BATCH_UPDATE_JOB)
    if (active) {
      throw new ApiError('batch_job_running', 'A batch job is already running for this zone', 409, { job_id: active.id })
    }

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
    const actives = await this.jobs.listActive()
    const hit = actives.find((job) => {
      if (job.type !== SAAS_BATCH_DELETE_JOB && job.type !== SAAS_BATCH_UPDATE_JOB) return false
      const payload = job.payload || {}
      return payload.provider_id === providerId && payload.zone_name === zoneName
    })
    return hit ? this.present(hit) : null
  }

  async retryFailed(jobId: string): Promise<SaasBatchJobView> {
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

  private async runDelete(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneName = String(payload.zone_name || '')
    const autoCleanup = payload.auto_cleanup !== false

    for (const raw of job.items) {
      const item = raw as Record<string, unknown>
      const hostname = String(item.hostname || '')
      if (!hostname || item.status === 'success' || item.status === 'skipped') continue

      await this.jobs.patchItem(
        job.id,
        (row) => String(row.hostname || '') === hostname,
        { status: 'running', message: '删除中' },
        { current: hostname, message: '批量删除执行中' },
      )

      try {
        await this.workflow.deleteHostname(providerId, zoneName, hostname, autoCleanup)
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.hostname || '') === hostname,
          { status: 'success', message: '已删除' },
        )
      } catch (error) {
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.hostname || '') === hostname,
          {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    await this.finish(job.id, '批量删除')
    await eventBus.emit({
      type: 'saas.hostname.mutated',
      provider_id: providerId,
      zone: zoneName,
      action: 'saas.hostname.batch_delete',
    })
  }

  private async runUpdate(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerId = String(payload.provider_id || '')
    const zoneName = String(payload.zone_name || '')
    const patch = (payload.patch || {}) as Record<string, unknown>
    const autoSync = payload.auto_sync !== false

    for (const raw of job.items) {
      const item = raw as Record<string, unknown>
      const hostname = String(item.hostname || '')
      if (!hostname || item.status === 'success' || item.status === 'skipped') continue

      await this.jobs.patchItem(
        job.id,
        (row) => String(row.hostname || '') === hostname,
        { status: 'running', message: '更新中' },
        { current: hostname, message: '批量修改执行中' },
      )

      try {
        await this.workflow.updateHostname(providerId, zoneName, hostname, patch, autoSync)
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.hostname || '') === hostname,
          { status: 'success', message: '已更新' },
        )
      } catch (error) {
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.hostname || '') === hostname,
          {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    await this.finish(job.id, '批量修改')
    await eventBus.emit({
      type: 'saas.hostname.mutated',
      provider_id: providerId,
      zone: zoneName,
      action: 'saas.hostname.batch_update',
      target: patch.preferred_domain ? String(patch.preferred_domain) : undefined,
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

  private normalizeHostnames(hostnames: string[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    for (const raw of hostnames || []) {
      const hostname = String(raw || '').trim().toLowerCase()
      if (!hostname || seen.has(hostname)) continue
      seen.add(hostname)
      out.push(hostname)
    }
    return out
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

  private async findActive(providerId: string, zoneName: string, type: string): Promise<SaasBatchJobView | null> {
    const actives = await this.jobs.listActive(type)
    const hit = actives.find((job) => {
      const payload = job.payload || {}
      return payload.provider_id === providerId && payload.zone_name === zoneName
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<SaasBatchJobView> {
    const job = await this.find(id)
    if (!job) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): SaasBatchJobView {
    const payload = job.payload || {}
    return {
      id: job.id,
      type: job.type,
      provider_id: String(payload.provider_id || ''),
      zone_name: String(payload.zone_name || ''),
      status: job.status,
      total: job.total,
      done: job.done,
      success: job.success,
      failed: job.failed,
      skipped: job.skipped,
      current: job.current,
      message: job.message,
      payload,
      items: job.items,
      created_at: job.created_at,
      updated_at: job.updated_at,
      finished_at: job.finished_at,
    }
  }
}
