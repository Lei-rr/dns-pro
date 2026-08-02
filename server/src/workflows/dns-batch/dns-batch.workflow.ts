import { ApiError } from '../../shared/http/api-error.js'
import { isExplicitNotFound } from '../../shared/providers/provider-error.js'
import type { JobRecord } from '../../platform/jobs/job.types.js'
import type { JobService } from '../../platform/jobs/job.service.js'
import {
  DNS_BATCH_CREATE_JOB,
  DNS_BATCH_DELETE_JOB,
  DNS_BATCH_UPDATE_JOB,
  DNS_ZONE_JOB_TYPES,
} from './dns-batch-job.types.js'
import { invalidateCloudflareRecordCache } from '../../modules/cloudflare/cloudflare.cache.js'
import { invalidateDnsPodRecordCache } from '../../modules/dns-pod/dns-pod.cache.js'
import {
  type BatchJobViewBase,
  findActiveBatchJob,
  finishBatchJob,
  presentBatchJobBase,
  requeueFailedBatchItems,
  runBatchItems,
} from '../../platform/jobs/batch-helpers.js'
import {
  buildCreateBody,
  buildUpdateBody,
  normalizeCreateRecords,
  normalizePatch,
  normalizeRecords,
  type BatchRecordInput,
} from './dns-record-payload.js'

const DNS_BATCH_JOB_TYPES: Set<string> = new Set(DNS_ZONE_JOB_TYPES)

type RecordCreator = {
  create(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown>
  findCreate(providerId: string, zone: string, data: Record<string, unknown>): Promise<unknown | null>
}

type RecordDeleter = {
  delete(providerId: string, zone: string, recordId: string): Promise<unknown>
}

type RecordUpdater = {
  update(providerId: string, zone: string, recordId: string, data: Record<string, unknown>): Promise<unknown>
}

export type DnsBatchJobView = BatchJobViewBase & {
  provider_type: string
  provider_id: string
  zone: string
}

/**
 * DNS record batch ops on JobService (DNSPod + Cloudflare).
 * - batch delete
 * - batch update (patch: value/ttl/line/proxied/remark/priority…)
 */
export class DnsBatchJobWorkflow {
  constructor(
    private readonly jobs: JobService,
    private readonly services: Record<string, RecordCreator & RecordDeleter & RecordUpdater>
  ) {
    this.jobs.registerRunner(DNS_BATCH_CREATE_JOB, (job) => this.runCreate(job))
    this.jobs.registerRunner(DNS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
    this.jobs.registerRunner(DNS_BATCH_UPDATE_JOB, (job) => this.runUpdate(job))
  }

  async createCreate(input: {
    providerType: string
    providerId: string
    zone: string
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
      },
      records.map((record) => ({ ...record, status: 'pending' })),
      { types: [...DNS_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone: input.zone } },
      { message: '批量添加 DNS 记录任务已创建' }
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
      { message: '批量删除 DNS 记录任务已创建' }
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
        value: record.value || '',
        ttl: record.ttl ?? '',
        line: record.line || '',
        record_line_id: record.record_line_id || '',
        priority: record.priority ?? '',
        remark: record.remark || '',
        proxied: record.proxied,
        record_status: record.status || '',
        weight: record.weight ?? '',
        status: 'pending',
      })),
      { types: [...DNS_ZONE_JOB_TYPES], scope: { provider_id: input.providerId, zone: input.zone } },
      { message: '批量修改 DNS 记录任务已创建' }
    )
    return this.present(job)
  }

  async find(id: string, providerType?: string, providerId?: string): Promise<DnsBatchJobView | null> {
    const job = await this.jobs.get(id)
    if (!job || !DNS_BATCH_JOB_TYPES.has(job.type)) return null
    if (providerType !== undefined && String(job.payload?.provider_type ?? '') !== providerType) return null
    if (providerId !== undefined && String(job.payload?.provider_id ?? '') !== providerId) return null
    return this.present(job)
  }

  async active(providerType: string, providerId: string, zone: string): Promise<DnsBatchJobView | null> {
    return this.findActive(providerType, providerId, zone)
  }

  async retryFailed(jobId: string, providerType?: string, providerId?: string): Promise<DnsBatchJobView> {
    const existing = await this.find(jobId, providerType, providerId)
    if (!existing) throw new ApiError('batch_job_not_found', 'Batch job not found', 404, { job_id: jobId })
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
        if (!String(item.name || '')) return { status: 'failed', message: '缺少记录名' }
        const body = buildCreateBody(providerType, zone, item)
        if (Number(item.attempt || 0) > 0) {
          const existing = await service.findCreate(providerId, zone, body)
          if (existing) {
            const recordId =
              typeof existing === 'object' && 'id' in existing
                ? String((existing as Record<string, unknown>).id ?? '')
                : ''
            return { status: 'skipped', message: '目标记录已存在，未重复添加', extra: { record_id: recordId } }
          }
        }
        const created = await service.create(providerId, zone, body)
        const recordId =
          created && typeof created === 'object' && 'id' in created
            ? String((created as Record<string, unknown>).id ?? '')
            : ''
        return { status: 'success', message: '已添加', extra: { record_id: recordId } }
      },
    })
    await this.finish(job.id, '批量添加', providerType, providerId, zone)
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
          if (isExplicitNotFound(error, { providerCode: /^ResourceNotFound\.NoDataOfRecord$/i })) {
            return { status: 'skipped', message: '记录已不存在（404）' }
          }
          throw error
        }
      },
    })

    await this.finish(job.id, '批量删除', providerType, providerId, zone)
  }

  private async runUpdate(job: JobRecord): Promise<void> {
    const payload = job.payload || {}
    const providerType = String(payload.provider_type || '')
    const providerId = String(payload.provider_id || '')
    const zone = String(payload.zone || '')
    const patch = payload.patch && typeof payload.patch === 'object' ? (payload.patch as Record<string, unknown>) : {}
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

    await this.finish(job.id, '批量修改', providerType, providerId, zone)
  }

  private requireService(providerType: string) {
    if (!this.services[providerType]) {
      throw new ApiError('batch_provider_unsupported', `Unsupported provider type: ${providerType}`, 422)
    }
  }

  private async failJob(id: string, message: string) {
    await this.jobs.patch(id, {
      status: 'failed',
      message,
      finished_at: Date.now(),
    })
  }

  private async finish(jobId: string, label: string, providerType: string, providerId: string, zone: string) {
    await finishBatchJob(this.jobs, jobId, label)
    if (providerType === 'cloudflare') {
      await invalidateCloudflareRecordCache(providerId, zone)
      return
    }
    if (providerType === 'dnspod') {
      await invalidateDnsPodRecordCache(providerId, zone)
      return
    }
    throw new ApiError('batch_provider_unsupported', `Unsupported provider type for batch finish: ${providerType}`, 422)
  }

  private async findActive(providerType: string, providerId: string, zone: string): Promise<DnsBatchJobView | null> {
    const hit = await findActiveBatchJob(this.jobs, [...DNS_ZONE_JOB_TYPES], {
      provider_type: providerType,
      provider_id: providerId,
      zone,
    })
    return hit ? this.present(hit) : null
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
}
