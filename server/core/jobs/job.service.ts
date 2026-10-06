import * as crypto from 'node:crypto'
import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../shared/values.js'
import { jobConflictsWith, type JobType } from './job-registry.js'
import {
  EXECUTION_SNAPSHOT_FIELDS,
  summarizeJobItems,
  type JobItem,
  type JobLock,
  type JobRecord,
  type JobStatus,
} from './job.types.js'

const ACTIVE: JobStatus[] = ['pending', 'running']
const TERMINAL: JobStatus[] = ['completed', 'failed']
/** 终态任务保留上限：超出后按结束时间淘汰最旧，避免长进程内存无界增长 */
const MAX_TERMINAL_JOBS = 500

type ItemExecutionClaim = { state: 'execute'; item: Record<string, unknown> } | { state: 'skip' | 'uncertain' }

/**
 * 单进程内存任务执行器：创建 / 重试 / 进度 / 终态 / 互斥。
 * 任务只活在进程内存里：进程重启即丢失，不做持久化与崩溃恢复。
 */
export class JobService {
  private readonly jobs = new Map<string, JobRecord>()
  private readonly runners = new Map<JobType, (job: JobRecord) => Promise<void>>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly starting = new Map<string, Promise<boolean>>()
  private closed = false

  registerRunner(type: JobType, runner: (job: JobRecord) => Promise<void>): void {
    this.runners.set(type, runner)
  }

  create(
    type: JobType,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    options: { start?: boolean; message?: string } = {}
  ): Promise<JobRecord> {
    return this.createExclusive(type, payload, items, undefined, options)
  }

  async createTerminalExclusive(
    type: JobType,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    lock: JobLock | undefined,
    options: {
      status: 'completed' | 'failed'
      message: string
      success: number
      failed: number
      skipped: number
    }
  ): Promise<JobRecord> {
    const job = this.buildJob({
      type,
      payload,
      items,
      status: options.status,
      done: items.length,
      success: options.success,
      failed: options.failed,
      skipped: options.skipped,
      message: options.message,
      finished: true,
    })
    this.assertNoActiveConflict(lock)
    return this.put(job)
  }

  async createExclusive(
    type: JobType,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    lock: JobLock | undefined,
    options: { start?: boolean; message?: string } = {}
  ): Promise<JobRecord> {
    const job = this.buildJob({
      type,
      payload,
      items: items.map((item) => ({ status: 'pending', ...item })),
      status: 'pending',
      done: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      message: options.message || 'pending',
    })
    this.assertNoActiveConflict(lock)
    this.put(job)
    if (options.start !== false) this.requestStart(job.id)
    return job
  }

  /** 任务骨架：id / 时间戳 / 计数集中构造，创建与终态创建共用 */
  private buildJob(input: {
    type: JobType
    payload: Record<string, unknown>
    items: Array<Record<string, unknown>>
    status: JobStatus
    done: number
    success: number
    failed: number
    skipped: number
    message: string
    finished?: boolean
  }): JobRecord {
    const now = Date.now()
    return {
      id: crypto.randomBytes(8).toString('hex'),
      type: input.type,
      status: input.status,
      total: input.items.length,
      done: input.done,
      success: input.success,
      failed: input.failed,
      skipped: input.skipped,
      payload: input.payload,
      items: input.items,
      created_at: now,
      updated_at: now,
      ...(input.finished ? { finished_at: now } : {}),
      message: input.message,
    }
  }

  async get(id: string): Promise<JobRecord | null> {
    const job = this.jobs.get(id)
    if (!job) return null
    if (ACTIVE.includes(job.status)) this.requestStart(job.id)
    return cloneJob(job)
  }

  async listActive(type?: JobType): Promise<JobRecord[]> {
    return this.activeJobs()
      .filter((job) => !type || job.type === type)
      .map((job) => cloneJob(job))
  }

  async patch(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    const job = this.jobs.get(id)
    if (!job || TERMINAL.includes(job.status)) return null
    return this.put({ ...job, ...patch, items: patch.items ?? job.items, updated_at: Date.now() })
  }

  /** 条目进度直接写入内存；jobPatch 可同时更新任务级字段（进度游标 / 消息） */
  async patchItem(
    id: string,
    match: (item: Record<string, unknown>) => boolean,
    itemPatch: Record<string, unknown>,
    jobPatch: Partial<JobRecord> = {}
  ): Promise<JobRecord | null> {
    const job = this.jobs.get(id)
    if (!job) return null
    if (TERMINAL.includes(job.status)) return cloneJob(job)
    const items = job.items.map((item) => (match(item) ? { ...item, ...itemPatch } : item))
    return this.put({ ...job, ...jobPatch, items, ...summarizeJobItems(items), updated_at: Date.now() })
  }

  async requeue(id: string, patch: Partial<JobRecord> = {}, lock?: JobLock): Promise<JobRecord> {
    const source = this.jobs.get(id)
    if (!source) throw new ApiError('job_not_found', `Job ${id} not found`, 404)
    if (ACTIVE.includes(source.status)) throw new ApiError('job_running', 'Job is still running', 409, { job_id: id })
    this.assertNoActiveConflict(lock, id)
    const updated: JobRecord = {
      ...source,
      status: 'pending',
      finished_at: undefined,
      ...patch,
      message: patch.message ?? 'requeued',
      updated_at: Date.now(),
    }
    this.put(updated)
    this.requestStart(id)
    return updated
  }

  async beginItemExecution(
    id: string,
    match: (item: Record<string, unknown>) => boolean,
    runningMessage: string,
    jobPatch: Partial<JobRecord> = {}
  ): Promise<ItemExecutionClaim> {
    const job = this.jobs.get(id)
    if (!job || !ACTIVE.includes(job.status)) return { state: 'skip' }
    let claim: ItemExecutionClaim = { state: 'skip' }
    let changed = false
    const items = job.items.map((item) => {
      if (!match(item)) return item
      const status = String(item.status || 'pending')
      if (['success', 'skipped', 'failed'].includes(status)) return item
      changed = true
      if (status === 'running') {
        // 条目停在执行中：结果未确认，不自动重放（可能已产生外部副作用）
        claim = { state: 'uncertain' }
        return { ...item, status: 'failed', message: '上次执行结果待确认，未自动重放，请核实后重试' }
      }
      const next = { ...item, status: 'running', message: runningMessage }
      claim = { state: 'execute', item: next }
      return next
    })
    if (changed) this.put({ ...job, ...jobPatch, items, ...summarizeJobItems(items), updated_at: Date.now() })
    return claim
  }

  async close(): Promise<void> {
    this.closed = true
    await this.drain()
  }

  async drain(): Promise<void> {
    while (this.starting.size || this.inflight.size) {
      await Promise.all([...this.starting.values(), ...this.inflight.values()])
    }
  }

  async stats(): Promise<{ total: number; active: number; finished: number }> {
    const items = this.list()
    const active = this.activeJobs().length
    return { total: items.length, active, finished: items.length - active }
  }

  private requestStart(jobId: string): void {
    void this.start(jobId).catch(() => undefined)
  }

  private start(jobId: string): Promise<boolean> {
    if (this.closed || this.inflight.has(jobId)) return Promise.resolve(false)
    const existing = this.starting.get(jobId)
    if (existing) return existing.then(() => false)
    // 先登记再启动：runner 的同步段会回到 get() 触发 requestStart，此时必须已能去重
    const attempt = Promise.resolve()
      .then(() => this.startNow(jobId))
      .finally(() => this.starting.delete(jobId))
    this.starting.set(jobId, attempt)
    return attempt
  }

  private async startNow(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job || !ACTIVE.includes(job.status) || this.closed) return false
    this.put({
      ...job,
      status: 'running',
      message: job.status === 'running' ? 'resuming' : 'running',
      updated_at: Date.now(),
    })
    const promise = this.runJob(jobId)
      .catch(() => undefined)
      .finally(() => this.inflight.delete(jobId))
    this.inflight.set(jobId, promise)
    return true
  }

  private async runJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job || !ACTIVE.includes(job.status)) return
    const runner = this.runners.get(job.type)
    if (!runner) {
      await this.patch(jobId, {
        status: 'failed',
        message: `No runner registered for job type: ${job.type}`,
        finished_at: Date.now(),
      })
      return
    }
    try {
      await runner(cloneJob(job))
      const after = this.jobs.get(jobId)
      if (after && ACTIVE.includes(after.status)) {
        await this.patch(jobId, {
          status: after.failed > 0 ? 'failed' : 'completed',
          done: after.total,
          finished_at: Date.now(),
          message: after.message || 'completed',
        })
      }
    } catch (error) {
      await this.patch(jobId, {
        status: 'failed',
        message: errorMessage(error),
        finished_at: Date.now(),
      })
    }
  }

  /** 写入内存并剥离已完成任务的执行期快照 */
  private put(job: JobRecord): JobRecord {
    const next = job.status === 'completed' ? stripExecutionSnapshots(job) : job
    this.jobs.set(next.id, next)
    this.pruneTerminalJobs()
    return next
  }

  /** 终态任务只保留最近 MAX_TERMINAL_JOBS 条（活跃任务不参与淘汰） */
  private pruneTerminalJobs(): void {
    if (this.jobs.size <= MAX_TERMINAL_JOBS) return
    const terminal = [...this.jobs.values()].filter((job) => TERMINAL.includes(job.status))
    const overflow = terminal.length - MAX_TERMINAL_JOBS
    if (overflow <= 0) return
    terminal
      .sort((a, b) => (a.finished_at ?? a.updated_at) - (b.finished_at ?? b.updated_at))
      .slice(0, overflow)
      .forEach((job) => this.jobs.delete(job.id))
  }

  private list(): JobRecord[] {
    return [...this.jobs.values()]
  }

  /** 「活跃」的唯一同步定义：检查与写入之间不能有 await 间隙，否则并发创建会同时通过互斥检查 */
  private activeJobs(): JobRecord[] {
    return this.list().filter((job) => ACTIVE.includes(job.status))
  }

  private assertNoActiveConflict(lock: JobLock | undefined, excludeId?: string): void {
    if (!lock) return
    const active = this.findActiveConflict(lock, excludeId)
    if (active) {
      throw new ApiError('batch_job_running', lock.message || 'A batch job is already running for this scope', 409, {
        job_id: active.id,
      })
    }
  }

  /**
   * 与目标资源冲突的活跃作业：互斥判定的唯一实现。
   * 创建/重试（assertNoActiveConflict）与面板反查（BatchJobKind.active）都只能走这里，
   * 「活跃」也复用同一份定义，于是「反查说没有作业」与「创建被 409 拒绝」不可能出自两个口径。
   */
  findActiveConflict(lock: JobLock, excludeId?: string): JobRecord | undefined {
    const conflict = this.activeJobs().find(
      (job) => job.id !== excludeId && lock.types.includes(job.type) && jobConflictsWith(job, lock)
    )
    return conflict ? cloneJob(conflict) : undefined
  }
}

/** 对外副本：items 元素也复制，防止调用方原地修改绕过 put() 污染内部状态 */
function cloneJob(job: JobRecord): JobRecord {
  return { ...job, items: job.items.map((item) => ({ ...item })) }
}

/** 剥离已完成任务的执行期快照字段（无字段时原样返回，避免无谓的对象重建） */
function stripExecutionSnapshots(job: JobRecord): JobRecord {
  const hasSnapshot = job.items.some((item) => EXECUTION_SNAPSHOT_FIELDS.some((field) => field in item))
  if (!hasSnapshot) return job
  return {
    ...job,
    items: job.items.map((item) => {
      const next: JobItem = { ...item }
      for (const field of EXECUTION_SNAPSHOT_FIELDS) delete next[field]
      return next
    }),
  }
}
