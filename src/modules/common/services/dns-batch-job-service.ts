import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../contracts/index.js'
import type { JobService } from '../../../platform/job/job-service.js'
import { eventBus } from '../../../platform/events/event-bus.js'
import { providerCacheTag, recordCacheTag } from '../../../lib/cache/provider-cache.js'

export const DNS_BATCH_DELETE_JOB = 'dns.batch_delete'

type RecordDeleter = {
  delete(providerId: string, zone: string, recordId: string): Promise<unknown>
}

export type DnsBatchJobView = {
  id: string
  type: string
  provider_type: string
  provider_id: string
  zone: string
  status: string
  total: number
  done: number
  success: number
  failed: number
  skipped: number
  current?: string
  message?: string
  items: Array<Record<string, unknown>>
  created_at: number
  updated_at: number
  finished_at?: number
}

/**
 * DNS record batch delete on JobService (DNSPod + Cloudflare).
 */
export class DnsBatchJobService {
  constructor(
    private readonly jobs: JobService,
    private readonly deleters: Record<string, RecordDeleter>,
  ) {
    this.jobs.registerRunner(DNS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
  }

  async createDelete(input: {
    providerType: string
    providerId: string
    zone: string
    records: Array<{ id: string; name?: string; type?: string }>
  }): Promise<DnsBatchJobView> {
    const records = (input.records || [])
      .map((item) => ({
        id: String(item.id || '').trim(),
        name: String(item.name || '').trim(),
        type: String(item.type || '').trim(),
      }))
      .filter((item) => item.id)

    if (!records.length) throw new ApiError('batch_empty', 'No records selected', 422)
    if (!this.deleters[input.providerType]) {
      throw new ApiError('batch_provider_unsupported', `Unsupported provider type: ${input.providerType}`, 422)
    }

    const active = await this.findActive(input.providerId, input.zone)
    if (active) {
      throw new ApiError('batch_job_running', 'A batch job is already running for this zone', 409, { job_id: active.id })
    }

    const job = await this.jobs.create(
      DNS_BATCH_DELETE_JOB,
      {
        provider_type: input.providerType,
        provider_id: input.providerId,
        zone: input.zone,
      },
      records.map((record) => ({
        record_id: record.id,
        name: record.name,
        type: record.type,
        status: 'pending',
      })),
      { message: '批量删除 DNS 记录任务已创建' },
    )
    return this.present(job)
  }

  async find(id: string): Promise<DnsBatchJobView | null> {
    const job = await this.jobs.get(id)
    if (!job || job.type !== DNS_BATCH_DELETE_JOB) return null
    return this.present(job)
  }

  async active(providerId: string, zone: string): Promise<DnsBatchJobView | null> {
    return this.findActive(providerId, zone)
  }

  async retryFailed(jobId: string): Promise<DnsBatchJobView> {
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
    const providerType = String(payload.provider_type || '')
    const providerId = String(payload.provider_id || '')
    const zone = String(payload.zone || '')
    const deleter = this.deleters[providerType]
    if (!deleter) {
      await this.jobs.patch(job.id, {
        status: 'failed',
        message: `Unsupported provider type: ${providerType}`,
        finished_at: Date.now(),
      })
      return
    }

    for (const raw of job.items) {
      const item = raw as Record<string, unknown>
      const recordId = String(item.record_id || '')
      if (!recordId || item.status === 'success' || item.status === 'skipped') continue

      const label = [item.name, item.type, recordId].filter(Boolean).join(' ')
      await this.jobs.patchItem(
        job.id,
        (row) => String(row.record_id || '') === recordId,
        { status: 'running', message: '删除中' },
        { current: label, message: '批量删除 DNS 记录执行中' },
      )

      try {
        await deleter.delete(providerId, zone, recordId)
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.record_id || '') === recordId,
          { status: 'success', message: '已删除' },
        )
      } catch (error) {
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.record_id || '') === recordId,
          {
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }

    const finalJob = await this.jobs.get(job.id)
    if (!finalJob) return
    const success = finalJob.items.filter((i) => i.status === 'success').length
    const failed = finalJob.items.filter((i) => i.status === 'failed').length
    const skipped = finalJob.items.filter((i) => i.status === 'skipped').length
    await this.jobs.patch(job.id, {
      status: failed > 0 && success === 0 ? 'failed' : 'completed',
      success,
      failed,
      skipped,
      done: finalJob.items.length,
      current: undefined,
      finished_at: Date.now(),
      message: failed
        ? `批量删除完成：成功 ${success}，失败 ${failed}，跳过 ${skipped}`
        : `批量删除完成：成功 ${success}，跳过 ${skipped}`,
    })

    await eventBus.emit({
      type: 'record.mutated',
      provider_id: providerId,
      zone,
      action: 'dns.record.batch_delete',
      cache_tags: [recordCacheTag(providerType, providerId, zone), providerCacheTag(providerId)],
    })
  }

  private async findActive(providerId: string, zone: string): Promise<DnsBatchJobView | null> {
    const actives = await this.jobs.listActive(DNS_BATCH_DELETE_JOB)
    const hit = actives.find((job) => {
      const payload = job.payload || {}
      return payload.provider_id === providerId && payload.zone === zone
    })
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<DnsBatchJobView> {
    const job = await this.find(id)
    if (!job) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): DnsBatchJobView {
    const payload = job.payload || {}
    return {
      id: job.id,
      type: job.type,
      provider_type: String(payload.provider_type || ''),
      provider_id: String(payload.provider_id || ''),
      zone: String(payload.zone || ''),
      status: job.status,
      total: job.total,
      done: job.done,
      success: job.success,
      failed: job.failed,
      skipped: job.skipped,
      current: job.current,
      message: job.message,
      items: job.items,
      created_at: job.created_at,
      updated_at: job.updated_at,
      finished_at: job.finished_at,
    }
  }
}
