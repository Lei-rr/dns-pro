import { ApiError } from '../../kernel/http/api-error.js'
import { isExplicitNotFound } from '../../kernel/providers/provider-error.js'
import type { JobService } from '../../kernel/jobs/job.service.js'
import type { JobRecord } from '../../kernel/jobs/job.types.js'
import {
  BatchJobKind,
  finishBatchJob,
  runBatchItems,
  type BatchJobViewBase,
  type BatchItemResult,
} from '../../kernel/jobs/batch-job.js'
import { ZONE_WRITE_JOB_TYPES, dnsZoneKey, readResourceKeys } from '../../kernel/jobs/job-types.js'
import {
  DNS_BATCH_CREATE_JOB,
  DNS_BATCH_DELETE_JOB,
  DNS_BATCH_UPDATE_JOB,
  DNS_ZONE_JOB_TYPES,
} from '../../kernel/jobs/job-types.js'
import {
  buildCreateBody,
  buildUpdateBody,
  normalizeCreateRecords,
  normalizePatch,
  normalizeRecords,
  type BatchRecordInput,
} from './dns-record-payload.js'

export type DnsProviderType = 'cloudflare' | 'dnspod'

/** 统一 DNS 记录操作端口（按服务商适配） */
export interface DnsBatchPort {
  create(providerId: string, zone: string, data: Record<string, unknown>): Promise<{ id?: unknown }>
  /** 重试时查找已创建的等价记录，避免重复添加 */
  findCreated(providerId: string, zone: string, data: Record<string, unknown>): Promise<{ id?: unknown } | null>
  update(providerId: string, zone: string, recordId: string, data: Record<string, unknown>): Promise<unknown>
  delete(providerId: string, zone: string, recordId: string): Promise<unknown>
}

type DnsBatchJobView = BatchJobViewBase & { provider_type: string; provider_id: string; zone: string }
type JobScope = { providerType: DnsProviderType; providerId: string; zone: string }

/** DNS 记录批量 添加/删除/修改（DNSPod + Cloudflare），同一站点内互斥 */
export class DnsBatchWorkflow {
  private readonly kind: BatchJobKind<DnsBatchJobView>

  constructor(
    private readonly jobs: JobService,
    private readonly ports: Record<DnsProviderType, DnsBatchPort>
  ) {
    this.kind = new BatchJobKind(jobs, {
      types: DNS_ZONE_JOB_TYPES,
      // 与 SaaS / EdgeOne 批量共享底层 DNS 写入锁
      lockTypes: ZONE_WRITE_JOB_TYPES,
      scopeKeys: ['provider_id', 'zone'],
      resourceKeys: readResourceKeys,
      present: (job, base) => ({
        ...base,
        provider_type: String(job.payload.provider_type ?? ''),
        provider_id: String(job.payload.provider_id ?? ''),
        zone: String(job.payload.zone ?? ''),
      }),
    })
    jobs.registerRunner(DNS_BATCH_CREATE_JOB, (job) => this.runCreate(job))
    jobs.registerRunner(DNS_BATCH_DELETE_JOB, (job) => this.runDelete(job))
    jobs.registerRunner(DNS_BATCH_UPDATE_JOB, (job) => this.runUpdate(job))
  }

  createCreate(input: JobScope & { records: BatchRecordInput[] }) {
    const records = normalizeCreateRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records to create', 422)
    return this.enqueue(DNS_BATCH_CREATE_JOB, input, {}, records, '批量添加 DNS 记录任务已创建')
  }

  createDelete(input: JobScope & { records: Array<{ id: string; name?: string; type?: string }> }) {
    const records = normalizeRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records selected', 422)
    const items = records.map((record) => ({ record_id: record.id, name: record.name, type: record.type }))
    return this.enqueue(DNS_BATCH_DELETE_JOB, input, {}, items, '批量删除 DNS 记录任务已创建')
  }

  createUpdate(input: JobScope & { records: BatchRecordInput[]; patch: Record<string, unknown> }) {
    const records = normalizeRecords(input.records)
    if (!records.length) throw new ApiError('batch_empty', 'No records selected', 422)
    const patch = normalizePatch(input.patch)
    if (!Object.keys(patch).length) throw new ApiError('batch_patch_empty', 'No fields to update', 422)
    // 保存记录快照：服务商更新接口要求完整字段
    const items = records.map(({ id, status, ...record }) => ({
      ...record,
      record_id: id,
      record_status: status ?? '',
    }))
    return this.enqueue(DNS_BATCH_UPDATE_JOB, input, { patch }, items, '批量修改 DNS 记录任务已创建')
  }

  find(id: string, providerType?: string, providerId?: string) {
    return this.kind.find(id, { provider_type: providerType, provider_id: providerId })
  }

  active(providerType: string, providerId: string, zone: string) {
    return this.kind.active({ provider_type: providerType, provider_id: providerId, zone })
  }

  retryFailed(id: string, providerType?: string, providerId?: string) {
    return this.kind.retryFailed(id, { provider_type: providerType, provider_id: providerId })
  }

  private async enqueue(
    type: string,
    scope: JobScope,
    extra: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    message: string
  ): Promise<DnsBatchJobView> {
    if (!this.ports[scope.providerType]) {
      throw new ApiError('batch_provider_unsupported', `Unsupported provider type: ${scope.providerType}`, 422)
    }
    const payload = {
      provider_type: scope.providerType,
      provider_id: scope.providerId,
      zone: scope.zone,
      resource_keys: [dnsZoneKey(scope.providerType, scope.providerId, scope.zone)],
      ...extra,
    }
    const job = await this.jobs.createExclusive(type, payload, items, this.kind.lock(payload), { message })
    return this.kind.present(job)
  }

  private runCreate(job: JobRecord) {
    return this.run(job, '批量添加', {
      itemKey: (item) => String(item.item_key ?? ''),
      runningMessage: '添加中',
      progressMessage: '批量添加 DNS 记录执行中',
      progressCurrent: (item) => [item.name, item.type].filter(Boolean).join(' '),
      execute: async ({ port, scope }, item) => {
        const body = buildCreateBody(scope.providerType, scope.zone, item)
        if (Number(item.attempt || 0) > 0) {
          const existing = await port.findCreated(scope.providerId, scope.zone, body)
          if (existing) {
            return {
              status: 'skipped',
              message: '目标记录已存在，未重复添加',
              extra: { record_id: String(existing.id ?? '') },
            }
          }
        }
        const created = await port.create(scope.providerId, scope.zone, body)
        return { status: 'success', message: '已添加', extra: { record_id: String(created.id ?? '') } }
      },
    })
  }

  private runDelete(job: JobRecord) {
    return this.run(job, '批量删除', {
      itemKey: (item) => String(item.record_id ?? ''),
      runningMessage: '删除中',
      progressMessage: '批量删除 DNS 记录执行中',
      progressCurrent: (item, id) => [item.name, item.type, id].filter(Boolean).join(' '),
      execute: async ({ port, scope }, _item, recordId) => {
        try {
          await port.delete(scope.providerId, scope.zone, recordId)
          return { status: 'success', message: '已删除' }
        } catch (error) {
          // 记录已不存在：目标状态已达成
          if (isExplicitNotFound(error, { providerCode: /^ResourceNotFound\.NoDataOfRecord$/i })) {
            return { status: 'skipped', message: '记录已不存在（404）' }
          }
          throw error
        }
      },
    })
  }

  private runUpdate(job: JobRecord) {
    const patch = (job.payload.patch ?? {}) as Record<string, unknown>
    return this.run(job, '批量修改', {
      itemKey: (item) => String(item.record_id ?? ''),
      runningMessage: '修改中',
      progressMessage: '批量修改 DNS 记录执行中',
      progressCurrent: (item, id) => [item.name, item.type, id].filter(Boolean).join(' '),
      execute: async ({ port, scope }, item, recordId) => {
        await port.update(
          scope.providerId,
          scope.zone,
          recordId,
          buildUpdateBody(scope.providerType, scope.zone, item, patch)
        )
        return { status: 'success', message: '已修改' }
      },
    })
  }

  /** 公共执行骨架：解析 scope → 逐条执行 → 收尾（每次变更已由模块失效记录缓存） */
  private async run(
    job: JobRecord,
    label: string,
    options: Omit<Parameters<typeof runBatchItems>[2], 'execute'> & {
      execute: (
        ctx: { port: DnsBatchPort; scope: JobScope },
        item: Record<string, unknown>,
        key: string
      ) => Promise<BatchItemResult>
    }
  ): Promise<void> {
    const scope: JobScope = {
      providerType: String(job.payload.provider_type ?? '') as DnsProviderType,
      providerId: String(job.payload.provider_id ?? ''),
      zone: String(job.payload.zone ?? ''),
    }
    const port = this.ports[scope.providerType]
    if (!port) {
      await this.jobs.patch(job.id, {
        status: 'failed',
        message: `Unsupported provider type: ${scope.providerType}`,
        finished_at: Date.now(),
      })
      return
    }
    await runBatchItems(this.jobs, job, {
      ...options,
      execute: (item, key) => options.execute({ port, scope }, item, key),
    })
    await finishBatchJob(this.jobs, job.id, label)
  }
}
