import { ApiError } from '../../../lib/http/api-error.js'
import type { JobRecord } from '../../../platform/job/types.js'
import type { JobService } from '../../../platform/job/job-service.js'
import {
  DNS_BATCH_CREATE_JOB,
  DNS_BATCH_DELETE_JOB,
  DNS_BATCH_UPDATE_JOB,
  DNS_ZONE_JOB_TYPES,
} from '../job-types.js'
import { emitCloudflareRecordMutated } from '../../cloudflare/events.js'
import { emitDnsPodRecordMutated } from '../../dnspod/events.js'
import {
  findActiveBatchJob,
  finishBatchJob,
  presentBatchJobBase,
  requeueFailedBatchItems,
  runBatchItems,
} from '../../../platform/job/batch-helpers.js'
import {
  buildCreateBody,
  buildUpdateBody,
  normalizeCreateRecords,
  normalizePatch,
  normalizeRecords,
  type BatchRecordInput,
} from './record-payload.js'

const DNS_BATCH_JOB_TYPES: Set<string> = new Set(DNS_ZONE_JOB_TYPES)

type RecordCreator = {
  create(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown>
}

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

/**
 * DNS record batch ops on JobService (DNSPod + Cloudflare).
 * - batch delete
 * - batch update (patch: value/ttl/line/proxied/remark/priority…)
 */
export class DnsBatchJobService {
  constructor(
    private readonly jobs: JobService,
    private readonly services: Record<string, RecordCreator & RecordDeleter & RecordUpdater>,
  ) {
    this.jobs.registerRunner(DNS_BATCH_CREATE_JOB, (job) => this.runCreate(job))
    this.jobs.registerRunner(DNS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
    this.jobs.registerRunner(DNS_BATCH_UPDATE_JOB, (job) => this.runUpdate(job))
  }

  async createCreate(input: {
    providerType: string
    providerId: string
    zone: string
    zoneName?: string
    records: BatchRecordInput[]
  }): Promise<DnsBatchJobView> {
    const records = normalizeCreateRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records to create', 422)
    this.requireService(input.providerType)

    const job = await this.jobs.createExclusive(
      DNS_BATCH_CREATE_JOB,
      {
        provider_type: input.providerType,
        provider_id: input.providerId,
        zone: input.zone,
        zone_name: input.zoneName || input.zone,
      },
      records.map((record) => ({ ...record, status: 'pending' })),
      { types: [...DNS_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone: input.zone } },
      { message: '批量添加 DNS 记录任务已创建' },
    )
    return this.present(job)
  }

  async createDelete(input: {
    providerType: string
    providerId: string
    zone: string
    records: Array<{ id: string; name?: string; type?: string }>
  }): Promise<DnsBatchJobView> {
    const records = normalizeRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records selected', 422)
    this.requireService(input.providerType)

    const job = await this.jobs.createExclusive(
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
      { types: [...DNS_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone: input.zone } },
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
    const records = normalizeRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records selected', 422)
    this.requireService(input.providerType)

    const patch = normalizePatch(input.patch)
    if (!Object.keys(patch).length) {
      throw new ApiError('batch_patch_empty', 'No fields to update', 422)
    }

    const job = await this.jobs.createExclusive(
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
      { types: [...DNS_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone: input.zone } },
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
    await this.require(jobId)
    const raw = await this.jobs.get(jobId)
    if (!raw) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: jobId })
    const payload = raw.payload || {}
    const requeued = await requeueFailedBatchItems(this.jobs, raw, {
      types: [...DNS_ZONE_JOB_TYPES],
      scope: { provider_id: String(payload.provider_id || ''), zone: String(payload.zone || '') },
    })
    return this.present(requeued)
  }

  private async runCreate(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerType = String(payload.provider_type || '')
    const providerId = String(payload.provider_id || '')
    const zone = String(payload.zone || '')
    const zoneName = String(payload.zone_name || zone)
    const service = this.services[providerType]
    if (!service) {
      await this.failJob(job.id, `Unsupported provider type: ${providerType}`)
      return
    }

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.item_key || ''),
      runningMessage: '添加中',
      progressMessage: '批量添加 DNS 记录执行中',
      progressCurrent: (item) => [item.name, item.type].filter(Boolean).join(' '),
      execute: async (item) => {
        if (!String(item.name || '')) {
          return { status: 'failed', message: '缺少记录名' }
        }
        const created = await service.create(providerId, zone, buildCreateBody(providerType, zoneName, item))
        const recordId =
          created && typeof created === 'object' && 'id' in created
            ? String((created as Record<string, unknown>).id ?? '')
            : ''
        return { status: 'success', message: '已添加', extra: { record_id: recordId } }
      },
    })
    await this.finish(job.id, '批量添加', providerType, providerId, zone, 'batch_create')
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

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.record_id || ''),
      runningMessage: '删除中',
      progressMessage: '批量删除 DNS 记录执行中',
      progressCurrent: (item, recordId) => [item.name, item.type, recordId].filter(Boolean).join(' '),
      execute: async (_item, recordId) => {
        try {
          await service.delete(providerId, zone, recordId)
          return { status: 'success', message: '已删除' }
        } catch (error) {
          // CF/DNSPod 记录已不存在时删会 404：目标态已达成，记为 skipped 而非 failed
          if (this.isProviderNotFound(error)) {
            return { status: 'skipped', message: '记录已不存在（404）' }
          }
          throw error
        }
      },
    })

    await this.finish(job.id, '批量删除', providerType, providerId, zone, 'batch_delete')
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

    await runBatchItems(this.jobs, job, {
      itemKey: (item) => String(item.record_id || ''),
      runningMessage: '修改中',
      progressMessage: '批量修改 DNS 记录执行中',
      progressCurrent: (item, recordId) => [item.name, item.type, recordId].filter(Boolean).join(' '),
      execute: async (item, recordId) => {
        const body = buildUpdateBody(providerType, zone, item, patch)
        await service.update(providerId, zone, recordId, body)
        return { status: 'success', message: '已修改' }
      },
    })

    await this.finish(job.id, '批量修改', providerType, providerId, zone, 'batch_update')
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
    await finishBatchJob(this.jobs, jobId, label)
    if (providerType === 'cloudflare') {
      await emitCloudflareRecordMutated(providerId, zone, action)
      return
    }
    if (providerType === 'dnspod') {
      await emitDnsPodRecordMutated(providerId, zone, action)
      return
    }
    throw new ApiError(
      'batch_provider_unsupported',
      `Unsupported provider type for batch finish: ${providerType}`,
      422,
    )
  }

  private async findActive(providerId: string, zone: string): Promise<DnsBatchJobView | null> {
    const hit = await findActiveBatchJob(
      this.jobs,
      [...DNS_ZONE_JOB_TYPES],
      { provider_id: providerId, zone },
    )
    return hit ? this.present(hit) : null
  }

  private async require(id: string): Promise<DnsBatchJobView> {
    const job = await this.find(id)
    if (!job) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    return job
  }

  private present(job: JobRecord): DnsBatchJobView {
    const base = presentBatchJobBase(job)
    const payload = job.payload || {}
    return {
      ...base,
      provider_type: String(payload.provider_type || ''),
      provider_id: String(payload.provider_id || ''),
      zone: String(payload.zone || ''),
    }
  }

  /** Cloudflare/DNSPod 删除时记录已不存在 → 404，批量删按目标态记 skipped */
  private isProviderNotFound(error: unknown): boolean {
    if (error instanceof ApiError && error.statusCode === 404) return true
    const msg = error instanceof Error ? error.message : String(error || '')
    return /\b404\b/i.test(msg) || /not\s*found/i.test(msg)
  }
}
