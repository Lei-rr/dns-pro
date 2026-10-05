import { ApiError } from '../../core/http/api-error.js'
import { isExplicitNotFound } from '../../core/providers/provider-error.js'
import type { JobService } from '../../core/jobs/job.service.js'
import type { JobRecord } from '../../core/jobs/job.types.js'
import {
  BatchJobKind,
  finishBatchJob,
  runBatchItems,
  type BatchJobViewBase,
  type BatchItemResult,
} from '../../core/jobs/batch-job.js'
import {
  DNS_BATCH_CREATE_JOB,
  DNS_BATCH_DELETE_JOB,
  DNS_BATCH_UPDATE_JOB,
  DNS_ZONE_JOB_TYPES,
  ZONE_WRITE_JOB_TYPES,
  dnsZoneKey,
  readResourceKeys,
} from '../../core/jobs/job-registry.js'
import {
  normalizeCreateRecords,
  normalizePatch,
  normalizeRecords,
  type BatchRecordInput,
} from './dns-record-payload.js'
import { findExistingRecord } from './dns-batch.idempotency.js'
import type { DnsRecordPort, DnsRecordValue } from '../../core/contracts/dns-record.port.js'

export type DnsProviderType = 'cloudflare' | 'dnspod'

function isDnsProviderType(value: string): value is DnsProviderType {
  return value === 'cloudflare' || value === 'dnspod'
}

type DnsBatchJobView = BatchJobViewBase & { provider_type: string; provider_id: string; zone: string }
type JobScope = { providerType: DnsProviderType; providerId: string; zone: string }

/** DNS 记录批量 添加/删除/修改（DNSPod + Cloudflare）；互斥按底层站点资源键，与 SaaS / EdgeOne 写入共用一把锁 */
export class DnsBatchWorkflow {
  private readonly kind: BatchJobKind<DnsBatchJobView>

  constructor(
    private readonly jobs: JobService,
    private readonly ports: Record<DnsProviderType, DnsRecordPort>
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
    // 记录启停状态改名为 record_status：任务条目的 status 会被执行骨架覆写为 running，
    // 沿用 item.status 会让幂等查重与 DISABLE 语义双双失效
    const items = records.map(({ status, ...record }) => ({ ...record, record_status: status ?? '' }))
    return this.enqueue(DNS_BATCH_CREATE_JOB, input, {}, items, '批量添加 DNS 记录任务已创建')
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

  active(providerType: DnsProviderType, providerId: string, zone: string) {
    // 反查与创建同一口径：同一站点资源键 + 共享互斥范围，跨工作流（SaaS / EdgeOne）命中也照实返回
    const scope = { providerType, providerId, zone }
    return this.kind.active({ provider_id: providerId, zone }, this.resourceKeys(scope))
  }

  retryFailed(id: string, providerType?: string, providerId?: string) {
    return this.kind.retryFailed(id, { provider_type: providerType, provider_id: providerId })
  }

  /**
   * 本工作流会写入的底层资源键：入队时写进 payload，反查时现算，
   * 两处共用这一份推导，探测与创建才不会再次分叉。
   */
  private resourceKeys(scope: JobScope): string[] {
    return [dnsZoneKey(scope.providerType, scope.providerId, scope.zone)]
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
      resource_keys: this.resourceKeys(scope),
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
        const value = toRecordValue(item)
        // 幂等显式策略：默认全查重（手动重提交与自动重试同一判定）
        const existing = await findExistingRecord(port, scope, value)
        if (existing) {
          return { status: 'skipped', message: '目标记录已存在，未重复添加', extra: { record_id: existing.id } }
        }
        const created = await port.create(scope.providerId, scope.zone, value)
        return { status: 'success', message: '已添加', extra: { record_id: created.id } }
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
          await port.remove(scope.providerId, scope.zone, recordId)
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
        await port.update(scope.providerId, scope.zone, recordId, mergeRecordValue(item, patch))
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
        ctx: { port: DnsRecordPort; scope: JobScope },
        item: Record<string, unknown>,
        key: string
      ) => Promise<BatchItemResult>
    }
  ): Promise<void> {
    // 任务 payload 由入队时的强类型写入，恢复执行时仍显式收窄，避免任意字符串绕过端口校验
    const requested = String(job.payload.provider_type ?? '')
    const providerType = isDnsProviderType(requested) ? requested : undefined
    const port = providerType ? this.ports[providerType] : undefined
    if (!providerType || !port) {
      await this.jobs.patch(job.id, {
        status: 'failed',
        message: `Unsupported provider type: ${requested}`,
        finished_at: Date.now(),
      })
      return
    }
    const scope: JobScope = {
      providerType,
      providerId: String(job.payload.provider_id ?? ''),
      zone: String(job.payload.zone ?? ''),
    }
    await runBatchItems(this.jobs, job, {
      ...options,
      execute: (item, key) => options.execute({ port, scope }, item, key),
    })
    await finishBatchJob(this.jobs, job.id, label)
  }
}

/** 批量条目 → 端口值（厂商字段映射由各适配器负责） */
function toRecordValue(item: Record<string, unknown>): DnsRecordValue {
  const value: DnsRecordValue = {
    type: String(item.type || 'A').toUpperCase(),
    name: String(item.name || '@'),
    value: String(item.value ?? ''),
  }
  if (item.ttl !== undefined && item.ttl !== '') value.ttl = Number(item.ttl)
  if (item.line !== undefined && item.line !== '') value.line = String(item.line)
  if (item.record_line_id !== undefined && item.record_line_id !== '') value.lineId = String(item.record_line_id)
  if (item.priority !== undefined && item.priority !== '') value.priority = Number(item.priority)
  if (item.remark !== undefined) value.note = String(item.remark)
  if (item.proxied !== undefined) value.proxied = Boolean(item.proxied)
  // 记录启停状态取自 record_status：item.status 是任务条目状态（执行骨架会覆写为 running）
  if (item.record_status !== undefined && item.record_status !== '') {
    value.status = String(item.record_status).toUpperCase()
  }
  if (item.weight !== undefined && item.weight !== '') value.weight = Number(item.weight)
  return value
}

/** 记录快照 + 修改补丁 → 端口值（item.status 是任务条目状态，记录启停状态保存在 record_status） */
function mergeRecordValue(item: Record<string, unknown>, patch: Record<string, unknown>): DnsRecordValue {
  const pick = (key: string, itemKey = key) => {
    const patched = patch[key]
    if (patched !== undefined && patched !== null && patched !== '') return patched
    const current = item[itemKey]
    return current !== undefined && current !== null && current !== '' ? current : undefined
  }
  return toRecordValue({
    // patch 由 normalizePatch 产出，只含可覆盖字段；type/name 恒取条目快照
    type: item.type,
    name: item.name,
    value: pick('value'),
    ttl: pick('ttl'),
    line: pick('line'),
    record_line_id: pick('record_line_id'),
    priority: pick('priority'),
    remark: pick('remark'),
    proxied: pick('proxied'),
    record_status: pick('status', 'record_status'),
    weight: pick('weight'),
  })
}
