import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../platform/job/types.js'
import type { JobService } from '../../../platform/job/job-service.js'
import { eventBus } from '../../../platform/events/event-bus.js'
import { providerCacheTag, recordCacheTag } from '../../../lib/cache/provider-cache.js'

export const DNS_BATCH_DELETE_JOB = 'dns.batch_delete'
export const DNS_BATCH_UPDATE_JOB = 'dns.batch_update'

const DNS_BATCH_JOB_TYPES = new Set([DNS_BATCH_DELETE_JOB, DNS_BATCH_UPDATE_JOB])

type RecordDeleter = {
  delete(providerId: string, zone: string, recordId: string): Promise<unknown>
}

type RecordUpdater = {
  update(
    providerId: string,
    zone: string,
    recordId: string,
    data: Record<string, unknown>,
  ): Promise<unknown>
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
  payload?: Record<string, unknown>
  items: Array<Record<string, unknown>>
  created_at: number
  updated_at: number
  finished_at?: number
}

type BatchRecordInput = {
  id: string
  name?: string
  type?: string
  value?: string
  content?: string
  ttl?: number | string
  line?: string
  record_line?: string
  record_line_id?: string
  mx?: number | string
  priority?: number | string
  remark?: string
  comment?: string
  proxied?: boolean
  subdomain?: string
  status?: string
  weight?: number | string
}

/**
 * DNS record batch ops on JobService (DNSPod + Cloudflare).
 * - batch delete
 * - batch update (patch: value/ttl/line/proxied/remark/priority…)
 */
export class DnsBatchJobService {
  constructor(
    private readonly jobs: JobService,
    private readonly services: Record<string, RecordDeleter & RecordUpdater>,
  ) {
    this.jobs.registerRunner(DNS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
    this.jobs.registerRunner(DNS_BATCH_UPDATE_JOB, (job) => this.runUpdate(job))
  }

  async createDelete(input: {
    providerType: string
    providerId: string
    zone: string
    records: Array<{ id: string; name?: string; type?: string }>
  }): Promise<DnsBatchJobView> {
    const records = this.normalizeRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records selected', 422)
    this.requireService(input.providerType)

    const active = await this.findActive(input.providerId, input.zone)
    if (active) {
      throw new ApiError('batch_job_running', 'A batch job is already running for this zone', 409, {
        job_id: active.id,
      })
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
        name: record.name || '',
        type: record.type || '',
        status: 'pending',
      })),
      { message: '批量删除 DNS 记录任务已创建' },
    )
    return this.present(job)
  }

  async createUpdate(input: {
    providerType: string
    providerId: string
    zone: string
    records: BatchRecordInput[]
    patch: Record<string, unknown>
  }): Promise<DnsBatchJobView> {
    const records = this.normalizeRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records selected', 422)
    this.requireService(input.providerType)

    const patch = this.normalizePatch(input.patch)
    if (!Object.keys(patch).length) {
      throw new ApiError('batch_patch_empty', 'No fields to update', 422)
    }

    const active = await this.findActive(input.providerId, input.zone)
    if (active) {
      throw new ApiError('batch_job_running', 'A batch job is already running for this zone', 409, {
        job_id: active.id,
      })
    }

    const job = await this.jobs.create(
      DNS_BATCH_UPDATE_JOB,
      {
        provider_type: input.providerType,
        provider_id: input.providerId,
        zone: input.zone,
        patch,
      },
      records.map((record) => ({
        record_id: record.id,
        name: record.name || '',
        type: record.type || '',
        value: record.value || record.content || '',
        content: record.content || record.value || '',
        ttl: record.ttl ?? '',
        line: record.line || record.record_line || '',
        record_line: record.record_line || record.line || '',
        record_line_id: record.record_line_id || '',
        mx: record.mx ?? record.priority ?? '',
        priority: record.priority ?? record.mx ?? '',
        remark: record.remark || record.comment || '',
        comment: record.comment || record.remark || '',
        proxied: record.proxied,
        subdomain: record.subdomain || record.name || '',
        record_status: record.status || '',
        weight: record.weight ?? '',
        status: 'pending',
      })),
      { message: '批量修改 DNS 记录任务已创建' },
    )
    return this.present(job)
  }

  async find(id: string): Promise<DnsBatchJobView | null> {
    const job = await this.jobs.get(id)
    if (!job || !DNS_BATCH_JOB_TYPES.has(job.type)) return null
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
    const service = this.services[providerType]
    if (!service) {
      await this.failJob(job.id, `Unsupported provider type: ${providerType}`)
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
        await service.delete(providerId, zone, recordId)
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

    await this.finish(job.id, '批量删除', providerType, providerId, zone, 'dns.record.batch_delete')
  }

  private async runUpdate(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerType = String(payload.provider_type || '')
    const providerId = String(payload.provider_id || '')
    const zone = String(payload.zone || '')
    const patch =
      payload.patch && typeof payload.patch === 'object'
        ? (payload.patch as Record<string, unknown>)
        : {}
    const service = this.services[providerType]
    if (!service) {
      await this.failJob(job.id, `Unsupported provider type: ${providerType}`)
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
        { status: 'running', message: '修改中' },
        { current: label, message: '批量修改 DNS 记录执行中' },
      )

      try {
        const body = this.buildUpdateBody(providerType, zone, item, patch)
        await service.update(providerId, zone, recordId, body)
        await this.jobs.patchItem(
          job.id,
          (row) => String(row.record_id || '') === recordId,
          { status: 'success', message: '已修改' },
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

    await this.finish(job.id, '批量修改', providerType, providerId, zone, 'dns.record.batch_update')
  }

  /**
   * Merge per-record snapshot + shared patch into provider update payload.
   * DNSPod / Cloudflare update APIs require full record fields.
   */
  private buildUpdateBody(
    providerType: string,
    zone: string,
    item: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const pick = (key: string, ...aliases: string[]) => {
      for (const k of [key, ...aliases]) {
        if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') return patch[k]
      }
      for (const k of [key, ...aliases]) {
        if (item[k] !== undefined && item[k] !== null && item[k] !== '') return item[k]
      }
      return undefined
    }

    if (providerType === 'cloudflare') {
      const nameRaw = String(pick('name', 'subdomain') ?? '@')
      const zoneName = zone
      const name =
        nameRaw === '@'
          ? zoneName
          : nameRaw.toLowerCase().endsWith('.' + zoneName.toLowerCase())
            ? nameRaw
            : `${nameRaw}.${zoneName}`

      const body: Record<string, unknown> = {
        type: String(pick('type', 'record_type') ?? 'A').toUpperCase(),
        name,
        content: String(pick('value', 'content') ?? ''),
        ttl: Number(pick('ttl') ?? 1) || 1,
      }
      const priority = pick('priority', 'mx')
      if (priority !== undefined) body.priority = Number(priority)
      const remark = pick('remark', 'comment')
      if (remark !== undefined) body.comment = String(remark)
      if (patch.proxied !== undefined) body.proxied = Boolean(patch.proxied)
      else if (item.proxied !== undefined) body.proxied = Boolean(item.proxied)
      return body
    }

    // DNSPod
    const body: Record<string, unknown> = {
      record_type: String(pick('type', 'record_type') ?? 'A').toUpperCase(),
      record_line: String(pick('line', 'record_line') ?? '默认') || '默认',
      value: String(pick('value', 'content') ?? ''),
      subdomain: String(pick('subdomain', 'name') ?? '@') || '@',
    }
    const ttl = pick('ttl')
    if (ttl !== undefined && ttl !== '') body.ttl = Number(ttl)
    const mx = pick('mx', 'priority')
    if (mx !== undefined && mx !== '') body.mx = Number(mx)
    const remark = pick('remark', 'comment')
    if (remark !== undefined) body.remark = String(remark)
    const lineId = pick('record_line_id')
    if (lineId !== undefined) body.record_line_id = String(lineId)
    const status = pick('status', 'record_status')
    if (status !== undefined) body.status = String(status).toUpperCase()
    const weight = pick('weight')
    if (weight !== undefined && weight !== '') body.weight = Number(weight)
    return body
  }

  private normalizeRecords(records: BatchRecordInput[]): BatchRecordInput[] {
    return (records || [])
      .map((item) => ({
        ...item,
        id: String(item.id || '').trim(),
        name: String(item.name || '').trim(),
        type: String(item.type || '').trim(),
        value: item.value !== undefined ? String(item.value) : item.content !== undefined ? String(item.content) : '',
      }))
      .filter((item) => item.id)
  }

  private normalizePatch(patch: Record<string, unknown> = {}): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const raw = patch && typeof patch === 'object' ? patch : {}

    const setString = (key: string, ...aliases: string[]) => {
      for (const k of [key, ...aliases]) {
        if (raw[k] === undefined || raw[k] === null) continue
        const text = String(raw[k]).trim()
        if (text === '') continue
        out[key] = text
        return
      }
    }
    const setNumber = (key: string, ...aliases: string[]) => {
      for (const k of [key, ...aliases]) {
        if (raw[k] === undefined || raw[k] === null || raw[k] === '') continue
        const num = Number(raw[k])
        if (!Number.isFinite(num)) continue
        out[key] = num
        return
      }
    }

    setString('value', 'content')
    setNumber('ttl')
    setString('line', 'record_line')
    setString('record_line_id')
    setString('remark', 'comment')
    setNumber('mx', 'priority')
    setNumber('priority', 'mx')
    setString('status')
    setNumber('weight')
    if (raw.proxied !== undefined && raw.proxied !== null && raw.proxied !== '') {
      out.proxied = raw.proxied === true || raw.proxied === 1 || raw.proxied === '1' || raw.proxied === 'true'
    }
    return out
  }

  private requireService(providerType: string) {
    if (!this.services[providerType]) {
      throw new ApiError(
        'batch_provider_unsupported',
        `Unsupported provider type: ${providerType}`,
        422,
      )
    }
  }

  private async failJob(id: string, message: string) {
    await this.jobs.patch(id, {
      status: 'failed',
      message,
      finished_at: Date.now(),
    })
  }

  private async finish(
    jobId: string,
    label: string,
    providerType: string,
    providerId: string,
    zone: string,
    action: string,
  ) {
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

    await eventBus.emit({
      type: 'record.mutated',
      provider_id: providerId,
      zone,
      action,
      cache_tags: [recordCacheTag(providerType, providerId, zone), providerCacheTag(providerId)],
    })
  }

  private async findActive(providerId: string, zone: string): Promise<DnsBatchJobView | null> {
    const actives = [
      ...(await this.jobs.listActive(DNS_BATCH_DELETE_JOB)),
      ...(await this.jobs.listActive(DNS_BATCH_UPDATE_JOB)),
    ]
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
