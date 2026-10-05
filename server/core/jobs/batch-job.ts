import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../shared/values.js'
import type { JobService } from './job.service.js'
import {
  EXECUTION_SNAPSHOT_FIELDS,
  summarizeJobItems,
  type JobItem,
  type JobLock,
  type JobRecord,
} from './job.types.js'
import { peekResourceKeys, scopeMatchesResourceKeys } from './job-types.js'

/** 批量任务对外视图公共字段 */
export type BatchJobViewBase = {
  id: string
  type: string
  status: string
  total: number
  done: number
  success: number
  failed: number
  skipped: number
  current?: string
  message?: string
  payload?: Record<string, unknown>
  items: JobItem[]
  created_at: number
  updated_at: number
  finished_at?: number
}

export type BatchItemResult = {
  status: 'success' | 'failed' | 'skipped'
  message?: string
  extra?: Record<string, unknown>
}

// 内部执行字段不对外暴露（执行期快照清单与 job.service 的内存剥离共用一份）
const INTERNAL_ITEM_FIELDS = new Set(['attempt', 'item_key', ...EXECUTION_SNAPSHOT_FIELDS])

/** 批量任务族：同一 scope 内互斥的一组任务类型 */
export class BatchJobKind<View> {
  constructor(
    private readonly jobs: JobService,
    private readonly options: {
      /** 本族可查询的任务类型 */
      types: readonly string[]
      /** 互斥锁类型：参与同一底层资源竞争的全部任务类型 */
      lockTypes: readonly string[]
      /** payload 中构成互斥范围的字段（用于按站点查询/展示） */
      scopeKeys: readonly string[]
      /** 本次任务会写入的底层资源键；跨工作流以交集判定互斥 */
      resourceKeys?: (payload: Record<string, unknown>) => string[]
      lockMessage?: string
      notFoundCode?: string
      present: (job: JobRecord, base: BatchJobViewBase) => View
    }
  ) {}

  /** 创建路径的互斥锁：payload 必须显式声明 resource_keys（缺失即装配错误，见 readResourceKeys） */
  lock(payload: Record<string, unknown>): JobLock {
    return this.buildLock(payload, this.options.resourceKeys?.(payload))
  }

  /**
   * 重试路径的互斥锁：读到的是历史 payload，早于资源键字段的旧任务同样要能重试，
   * 因此缺失时退化为 scope 判定而不是抛错（查询/重试都不该因旧数据失败）。
   */
  private retryLock(payload: Record<string, unknown>): JobLock {
    return this.buildLock(payload, peekResourceKeys(payload))
  }

  private buildLock(payload: Record<string, unknown>, resourceKeys: string[] | undefined): JobLock {
    return {
      types: this.options.lockTypes,
      scope: this.scopeOf(payload),
      resourceKeys,
      message: this.options.lockMessage,
    }
  }

  /** 查找本族任务；scope 给出时要求 payload 匹配（防止跨服务商访问） */
  async find(id: string, scope: Record<string, string | undefined> = {}): Promise<View | null> {
    const job = await this.findRecord(id, scope)
    return job ? this.present(job) : null
  }

  /** 读取路径的归属校验：不存在与归属不匹配共用同一 not_found 口径，避免探测任务存在性 */
  async require(id: string, scope: Record<string, string | undefined> = {}): Promise<View> {
    return this.present(await this.requireRecord(id, scope))
  }

  /**
   * 与创建时的互斥判定同口径地查找活跃任务：跨工作流靠资源键对齐，命中即返回（不再按本族 types 过滤，
   * 否则 DNS 站点上正在跑的 SaaS/EdgeOne 任务查询不到，而创建却会被 409 拒绝）。
   * queryKeys 是本次查询所代表底层资源的键（各工作流自行解析）：SaaS/EdgeOne 查询里的 provider_id 是
   * SaaS/EdgeOne 服务商，而任务资源键里带的是被关联的 DNS 服务商，只比 payload 字段会整片漏报。
   * 展示字段用查询 scope 兜底：其它工作流的 payload 字段名不同（zone_name / zone_id），直接透出会留下空站点。
   */
  async active(scope: Record<string, string>, queryKeys: readonly string[] = []): Promise<View | null> {
    const job = await findActiveBatchJob(this.jobs, this.options.lockTypes, scope, queryKeys)
    if (!job) return null
    return this.present({ ...job, payload: { ...scope, ...job.payload } })
  }

  /** 失败项重新入队 */
  async retryFailed(id: string, scope: Record<string, string | undefined> = {}): Promise<View> {
    const job = await this.requireRecord(id, scope)
    return this.present(await requeueFailedBatchItems(this.jobs, job, this.retryLock(job.payload)))
  }

  present(job: JobRecord): View {
    return this.options.present(job, presentBatchJobBase(job))
  }

  private async requireRecord(id: string, scope: Record<string, string | undefined>): Promise<JobRecord> {
    const job = await this.findRecord(id, scope)
    if (!job) {
      throw new ApiError(this.options.notFoundCode ?? 'batch_job_not_found', 'Batch job not found', 404, { job_id: id })
    }
    return job
  }

  private async findRecord(id: string, scope: Record<string, string | undefined>): Promise<JobRecord | null> {
    const job = await this.jobs.get(id)
    if (!job || !this.options.types.includes(job.type)) return null
    const matches = Object.entries(scope).every(
      ([key, value]) => value === undefined || String(job.payload?.[key] ?? '') === value
    )
    return matches ? job : null
  }

  private scopeOf(payload: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(this.options.scopeKeys.map((key) => [key, String(payload[key] ?? '')]))
  }
}

/** 按条目计数收尾；任务已进入终态时 jobs.patch 返回 null，原状态保持不变 */
export async function finishBatchJob(jobs: JobService, jobId: string, label: string): Promise<JobRecord | null> {
  const job = await jobs.get(jobId)
  if (!job) return job
  const { success, failed, skipped } = summarizeJobItems(job.items)
  return jobs.patch(jobId, {
    status: failed > 0 ? 'failed' : 'completed',
    success,
    failed,
    skipped,
    done: job.items.length,
    current: undefined,
    finished_at: Date.now(),
    message: failed
      ? `${label}完成：成功 ${success}，失败 ${failed}，跳过 ${skipped}`
      : `${label}完成：成功 ${success}，跳过 ${skipped}`,
  })
}

/** 在 types 中查找与 scope 冲突的活跃任务（与 assertNoActiveConflict 同口径，见 matchesLockScope） */
async function findActiveBatchJob(
  jobs: JobService,
  types: readonly string[],
  scope: Record<string, string>,
  queryKeys: readonly string[]
): Promise<JobRecord | null> {
  const active = await jobs.listActive()
  return active.find((job) => types.includes(job.type) && matchesLockScope(job, scope, queryKeys)) ?? null
}

/**
 * 冲突判定：查询侧资源键与任务资源键有交集，或 scope 能对上任务资源键（跨工作流），或 payload 同名字段相等。
 * 交集判定不解析键内服务商，因此不要求查询的 provider_id 与键内服务商一致。
 */
function matchesLockScope(job: JobRecord, scope: Record<string, string>, queryKeys: readonly string[]): boolean {
  const jobKeys = peekResourceKeys(job.payload)
  if (queryKeys.length > 0 && jobKeys.some((key) => queryKeys.includes(key))) return true
  if (scopeMatchesResourceKeys(scope, jobKeys)) return true
  return Object.entries(scope).every(([key, value]) => String(job.payload?.[key] ?? '') === value)
}

/** 失败项改回 pending 并重新入队 */
async function requeueFailedBatchItems(jobs: JobService, job: JobRecord, lock: JobLock): Promise<JobRecord> {
  if (!job.items.some((item) => item.status === 'failed')) {
    throw new ApiError('batch_no_failed', 'No failed items to retry', 422)
  }
  const items = job.items.map((item) =>
    item.status === 'failed'
      ? { ...item, status: 'pending', message: undefined, attempt: Number(item.attempt || 0) + 1 }
      : item
  )
  return jobs.requeue(job.id, { items, ...summarizeJobItems(items), message: '失败项重试中' }, lock)
}

/** 顺序执行批量条目；每条目先认领再执行，停在执行中的条目不自动重放 */
export async function runBatchItems(
  jobs: JobService,
  job: JobRecord,
  options: {
    itemKey: (item: JobItem) => string
    runningMessage: string
    progressMessage: string
    /** 进度游标（默认为条目键） */
    progressCurrent?: (item: JobItem, key: string) => string
    execute: (item: JobItem, key: string) => Promise<BatchItemResult>
  }
): Promise<void> {
  for (const raw of job.items) {
    const key = options.itemKey(raw)
    if (!key || raw.status === 'success' || raw.status === 'skipped') continue

    const matchKey = (row: JobItem) => options.itemKey(row) === key
    const claim = await jobs.beginItemExecution(job.id, matchKey, options.runningMessage, {
      current: options.progressCurrent?.(raw, key) ?? key,
      message: options.progressMessage,
    })
    if (claim.state !== 'execute') continue

    try {
      const result = await options.execute(claim.item, key)
      await jobs.patchItem(job.id, matchKey, { status: result.status, message: result.message, ...result.extra })
    } catch (error) {
      await jobs.patchItem(job.id, matchKey, { status: 'failed', message: errorMessage(error) })
    }
  }
}

/** 记录阶段标记，再继续下一个不可逆外部操作 */
export async function persistItemStage(
  jobs: JobService,
  jobId: string,
  match: (row: JobItem) => boolean,
  patch: Record<string, unknown>
): Promise<void> {
  await jobs.patchItem(jobId, match, patch)
}

/** JobRecord → 对外视图骨架 */
function presentBatchJobBase(job: JobRecord): BatchJobViewBase {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    total: job.total,
    done: job.done,
    success: job.success,
    failed: job.failed,
    skipped: job.skipped,
    current: job.current == null ? undefined : String(job.current),
    message: job.message,
    payload: job.payload,
    items: job.items.map((item) =>
      Object.fromEntries(Object.entries(item).filter(([field]) => !INTERNAL_ITEM_FIELDS.has(field)))
    ),
    created_at: job.created_at,
    updated_at: job.updated_at,
    finished_at: job.finished_at,
  }
}

/** 去空、去重、规范化 */
export function dedupeStrings(values: string[], normalize = (v: string) => v.trim().toLowerCase()): string[] {
  return [...new Set(values.map((value) => normalize(String(value ?? ''))).filter(Boolean))]
}

/** 从批量条目结果中读取 DNS 副作用 */
export function dnsEffectOf(
  result: Record<string, unknown>,
  kind: 'sync' | 'cleanup'
): { status?: string; message?: string } | undefined {
  return (result as { side_effects?: { dns?: Record<string, { status?: string; message?: string }> } }).side_effects
    ?.dns?.[kind]
}

/** DNS 副作用 → 条目消息后缀 */
export function dnsEffectNote(effect: { status?: string; message?: string } | undefined, done: string): string {
  if (effect?.status === 'completed') return `（${done}）`
  if (effect?.status === 'skipped') return `（DNS 跳过：${effect.message || '已跳过'}）`
  return ''
}
