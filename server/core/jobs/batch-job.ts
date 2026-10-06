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
import { peekResourceKeys, payloadMatchesScope, type JobType } from './job-registry.js'

/**
 * 站点标识字段名：payload 里构成互斥范围的字段。
 * 各批量工作流只用到这四个键，用闭合联合把它钉住——写错字段名会让互斥范围悄悄变空。
 */
type BatchScopeKey = 'provider_id' | 'zone' | 'zone_name' | 'zone_id'

/** 批量任务对外视图公共字段 */
export type BatchJobViewBase = {
  id: string
  type: JobType
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
const INTERNAL_ITEM_FIELDS = new Set(['item_key', ...EXECUTION_SNAPSHOT_FIELDS])

/** 批量任务族：互斥范围与资源键同族共享，创建/重试/反查共用同一份互斥判定 */
export class BatchJobKind<View> {
  constructor(
    private readonly jobs: JobService,
    private readonly options: {
      /** 本族可查询的任务类型：详情/重试的取值与归属范围；不参与互斥判定（反查可能命中别族任务） */
      types: readonly JobType[]
      /** 互斥范围：参与同一底层资源竞争的全部任务类型（创建/重试/反查共用） */
      lockTypes: readonly JobType[]
      /** payload 中构成站点标识的字段（展示取值与老作业降级判定共用同一套投影） */
      scopeKeys: readonly BatchScopeKey[]
      /** 创建路径的资源键：payload 里已经算好的键；跨工作流以交集判定互斥 */
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

  /**
   * 互斥输入的唯一构造点：站点标识一律按 scopeKeys 投影，资源键由调用方给出，
   * 创建、重试、反查三条路径构造出的都是同一个 JobLock，判定交给 JobService.findActiveConflict。
   */
  private buildLock(source: Record<string, unknown>, resourceKeys: readonly string[] | undefined): JobLock {
    return {
      types: this.options.lockTypes,
      scope: this.scopeOf(source),
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
   * 查找该站点上的活跃作业：与创建/重试同一口径——同一互斥范围（lockTypes）+ 资源键交集，
   * 判定由 JobService.findActiveConflict 给出，所以不可能再出现「反查说没有作业、创建却 409」。
   * 跨工作流命中的作业也照实返回（视图骨架相同，其 payload 字段名不同处取空串）：
   * 面板要看的正是「这块底层资源上有没有作业在跑」，而不是「有没有本族的作业」。
   * @param scope 站点事实，字段名与 scopeKeys 一致（与创建路径从 payload 取值的投影规则相同）
   * @param resourceKeys 该站点会写入的底层资源键：必须与创建时写进 payload.resource_keys 的是同一份推导
   */
  async active(scope: Record<string, string>, resourceKeys: readonly string[]): Promise<View | null> {
    const job = this.jobs.findActiveConflict(this.buildLock(scope, resourceKeys))
    return job ? this.present(job) : null
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

  /** 详情端点的归属校验：只认本族类型 + payload 字段匹配（与互斥判定无关，见 payloadMatchesScope） */
  private async findRecord(id: string, scope: Record<string, string | undefined>): Promise<JobRecord | null> {
    const job = await this.jobs.get(id)
    if (!job || !this.options.types.includes(job.type)) return null
    return payloadMatchesScope(job, scope) ? job : null
  }

  /** 站点标识投影：payload 与查询 scope 共用同一套字段名，创建与反查落在同一份互斥输入上 */
  private scopeOf(source: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(this.options.scopeKeys.map((key) => [key, String(source[key] ?? '')]))
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

/** 失败项改回 pending 并重新入队 */
async function requeueFailedBatchItems(jobs: JobService, job: JobRecord, lock: JobLock): Promise<JobRecord> {
  if (!job.items.some((item) => item.status === 'failed')) {
    throw new ApiError('batch_no_failed', 'No failed items to retry', 422)
  }
  const items = job.items.map((item) =>
    item.status === 'failed' ? { ...item, status: 'pending', message: undefined } : item
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
