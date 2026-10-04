import * as crypto from 'node:crypto'
import { JsonStore } from '../store/json-store.js'
import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../lib/values.js'
import { summarizeJobItems, type JobItem, type JobLock, type JobRecord, type JobStatus } from './job.types.js'

export type { JobRecord } from './job.types.js'

export type JobsFile = { items: JobRecord[] }
const ACTIVE: JobStatus[] = ['pending', 'running']
const TERMINAL: JobStatus[] = ['completed', 'failed']
const FINISHED_RETENTION = 100
const PROGRESS_FLUSH_MS = 250
/**
 * 仅用于执行期恢复的内部快照字段。
 * 已完成任务不可能再重试，剥离以控制任务文件体积；
 * 失败任务保留（重试需要更新前的 DNS 快照）。
 */
const EXECUTION_SNAPSHOT_FIELDS = ['dns_before_records', 'cleanup_recipe'] as const

type ItemExecutionClaim = { state: 'execute'; item: Record<string, unknown> } | { state: 'skip' | 'uncertain' }

/**
 * 单进程持久化任务：创建 / 恢复 / 重试 / 进度 / 终态。
 * 进度写入合并节流（PROGRESS_FLUSH_MS），条目终态立即落盘。
 */
export class JobService {
  private readonly runners = new Map<string, (job: JobRecord) => Promise<void>>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly starting = new Map<string, Promise<boolean>>()
  private readonly progressTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly progressFlushes = new Map<string, Promise<void>>()
  private readonly pendingProgress = new Map<
    string,
    Array<{
      match: (item: Record<string, unknown>) => boolean
      itemPatch: Record<string, unknown>
      jobPatch: Partial<JobRecord>
    }>
  >()
  private resumeStarted = false
  private closed = false

  constructor(private readonly store: JsonStore<JobsFile>) {}

  registerRunner(type: string, runner: (job: JobRecord) => Promise<void>): void {
    this.runners.set(type, runner)
  }

  create(
    type: string,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    options: { start?: boolean; message?: string } = {}
  ): Promise<JobRecord> {
    return this.createExclusive(type, payload, items, undefined, options)
  }

  async createTerminalExclusive(
    type: string,
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
    const now = Date.now()
    const job: JobRecord = {
      id: crypto.randomBytes(8).toString('hex'),
      type,
      status: options.status,
      total: items.length,
      done: items.length,
      success: options.success,
      failed: options.failed,
      skipped: options.skipped,
      payload,
      items,
      created_at: now,
      updated_at: now,
      finished_at: now,
      message: options.message,
    }
    await this.store.transaction((current) => {
      this.assertNoActiveConflict(current.items ?? [], lock)
      return { next: { items: this.compactList([...(current.items ?? []), job]) } }
    })
    return job
  }

  async createExclusive(
    type: string,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    lock: JobLock | undefined,
    options: { start?: boolean; message?: string } = {}
  ): Promise<JobRecord> {
    const now = Date.now()
    const job: JobRecord = {
      id: crypto.randomBytes(8).toString('hex'),
      type,
      status: 'pending',
      total: items.length,
      done: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      payload,
      items: items.map((item) => ({ status: 'pending', ...item })),
      created_at: now,
      updated_at: now,
      message: options.message || 'pending',
    }
    await this.store.transaction((current) => {
      this.assertNoActiveConflict(current.items ?? [], lock)
      return { next: { items: this.compactList([...(current.items ?? []), job]) } }
    })
    if (options.start !== false) this.requestStart(job.id)
    return job
  }

  async get(id: string): Promise<JobRecord | null> {
    await this.flushProgress(id)
    const job = (await this.all()).find((item) => item.id === id) ?? null
    if (job && ACTIVE.includes(job.status)) this.requestStart(job.id)
    return job
  }

  async listActive(type?: string): Promise<JobRecord[]> {
    return (await this.all()).filter((job) => ACTIVE.includes(job.status) && (!type || job.type === type))
  }

  async resumeActiveJobs(): Promise<number> {
    if (this.resumeStarted) return 0
    this.resumeStarted = true
    // 无内容需要压缩时不写盘，避免每次启动都重写任务文件
    const stored = (await this.store.read()).items ?? []
    if (this.compactList(stored) !== stored) {
      await this.store.transaction((current) => ({ next: { items: this.compactList(current.items ?? []) } }))
    }
    let resumed = 0
    for (const job of await this.listActive()) if (await this.start(job.id)) resumed++
    return resumed
  }

  async patch(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    await this.flushProgress(id)
    let updated: JobRecord | null = null
    await this.store.transaction((current) => {
      const items = (current.items ?? []).map((job) => {
        if (job.id !== id || TERMINAL.includes(job.status)) return job
        updated = { ...job, ...patch, items: patch.items ?? job.items, updated_at: Date.now() }
        return updated
      })
      return { next: { items: this.maybeCompact(items, patch.status) } }
    })
    return updated
  }

  async patchItem(
    id: string,
    match: (item: Record<string, unknown>) => boolean,
    itemPatch: Record<string, unknown>,
    jobPatch: Partial<JobRecord> = {}
  ): Promise<JobRecord | null> {
    const queue = this.pendingProgress.get(id) ?? []
    queue.push({ match, itemPatch, jobPatch })
    this.pendingProgress.set(id, queue)
    const immediate =
      TERMINAL.includes(String(jobPatch.status || '') as JobStatus) ||
      ['success', 'failed', 'skipped'].includes(String(itemPatch.status || ''))
    this.scheduleProgressFlush(id, immediate ? 0 : PROGRESS_FLUSH_MS)
    return this.previewWithPending(id)
  }

  async requeue(id: string, patch: Partial<JobRecord> = {}, lock?: JobLock): Promise<JobRecord> {
    await this.flushProgress(id)
    let updated: JobRecord | null = null
    await this.store.transaction((current) => {
      const source = (current.items ?? []).find((job) => job.id === id)
      if (!source) throw new ApiError('job_not_found', `Job ${id} not found`, 404)
      if (ACTIVE.includes(source.status)) throw new ApiError('job_running', 'Job is still running', 409, { job_id: id })
      this.assertNoActiveConflict(
        (current.items ?? []).filter((job) => job.id !== id),
        lock
      )
      updated = {
        ...source,
        status: 'pending',
        finished_at: undefined,
        message: patch.message || 'requeued',
        ...patch,
        updated_at: Date.now(),
      }
      return { next: { items: (current.items ?? []).map((job) => (job.id === id ? updated! : job)) } }
    })
    this.requestStart(id)
    return updated!
  }

  async beginItemExecution(
    id: string,
    match: (item: Record<string, unknown>) => boolean,
    runningMessage: string,
    jobPatch: Partial<JobRecord> = {}
  ): Promise<ItemExecutionClaim> {
    await this.flushProgress(id)
    let claim: ItemExecutionClaim = { state: 'skip' }
    await this.store.transaction((current) => {
      const items = (current.items ?? []).map((job) => {
        if (job.id !== id || !ACTIVE.includes(job.status)) return job
        let changed = false
        const nextItems = job.items.map((item) => {
          if (!match(item)) return item
          const status = String(item.status || 'pending')
          if (['success', 'skipped', 'failed'].includes(status)) return item
          changed = true
          if (status === 'running') {
            claim = { state: 'uncertain' }
            return { ...item, status: 'failed', message: '上次执行结果待确认，未自动重放，请核实后重试' }
          }
          const next = { ...item, status: 'running', message: runningMessage }
          claim = { state: 'execute', item: next }
          return next
        })
        return changed
          ? { ...job, ...jobPatch, items: nextItems, ...summarizeJobItems(nextItems), updated_at: Date.now() }
          : job
      })
      return { next: { items } }
    })
    return claim
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.starting.values()])
    await Promise.all([...this.inflight.values()])
    for (const timer of this.progressTimers.values()) clearTimeout(timer)
    this.progressTimers.clear()
    for (const id of [...this.pendingProgress.keys()]) await this.flushProgress(id)
    await Promise.all([...this.progressFlushes.values()])
  }

  async drain(): Promise<void> {
    while (this.starting.size || this.inflight.size || this.progressFlushes.size || this.pendingProgress.size) {
      await Promise.all([...this.starting.values(), ...this.inflight.values(), ...this.progressFlushes.values()])
      for (const id of [...this.pendingProgress.keys()]) await this.flushProgress(id)
    }
  }

  async stats(): Promise<{ total: number; active: number; finished: number }> {
    const items = await this.all()
    const active = items.filter((job) => ACTIVE.includes(job.status)).length
    return { total: items.length, active, finished: items.length - active }
  }

  private requestStart(jobId: string): void {
    void this.start(jobId).catch(() => undefined)
  }

  private start(jobId: string): Promise<boolean> {
    if (this.closed || this.inflight.has(jobId)) return Promise.resolve(false)
    const existing = this.starting.get(jobId)
    if (existing) return existing.then(() => false)
    const attempt = this.startNow(jobId).finally(() => this.starting.delete(jobId))
    this.starting.set(jobId, attempt)
    return attempt
  }

  private async startNow(jobId: string): Promise<boolean> {
    let runnable: JobRecord | null = null
    await this.store.transaction((current) => {
      const items = (current.items ?? []).map((job) => {
        if (job.id !== jobId || !ACTIVE.includes(job.status)) return job
        runnable = {
          ...job,
          status: 'running',
          message: job.status === 'running' ? 'resuming' : 'running',
          updated_at: Date.now(),
        }
        return runnable
      })
      return { next: { items } }
    })
    if (!runnable || this.closed) return false
    const promise = this.runJob(jobId)
      .catch(() => undefined)
      .finally(() => this.inflight.delete(jobId))
    this.inflight.set(jobId, promise)
    return true
  }

  private async runJob(jobId: string): Promise<void> {
    const job = (await this.all()).find((item) => item.id === jobId)
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
      await runner(job)
      await this.flushProgress(jobId)
      const after = (await this.all()).find((item) => item.id === jobId)
      if (after && ACTIVE.includes(after.status)) {
        await this.patch(jobId, {
          status: after.failed > 0 ? 'failed' : 'completed',
          done: after.total,
          finished_at: Date.now(),
          message: after.message || 'completed',
        })
      }
    } catch (error) {
      await this.flushProgress(jobId)
      await this.patch(jobId, {
        status: 'failed',
        message: errorMessage(error),
        finished_at: Date.now(),
      })
    }
  }

  private scheduleProgressFlush(id: string, delayMs: number): void {
    const existing = this.progressTimers.get(id)
    if (existing) {
      if (delayMs !== 0) return
      clearTimeout(existing)
    }
    const timer = setTimeout(() => {
      this.progressTimers.delete(id)
      void this.flushProgress(id).catch(() => {
        if (this.pendingProgress.get(id)?.length) this.scheduleProgressFlush(id, PROGRESS_FLUSH_MS)
      })
    }, delayMs)
    timer.unref?.()
    this.progressTimers.set(id, timer)
  }

  private flushProgress(id: string): Promise<void> {
    const previous = this.progressFlushes.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => this.flushProgressBatch(id))
    this.progressFlushes.set(id, current)
    void current
      .finally(() => {
        if (this.progressFlushes.get(id) === current) this.progressFlushes.delete(id)
      })
      .catch(() => undefined)
    return current
  }

  private async flushProgressBatch(id: string): Promise<void> {
    const timer = this.progressTimers.get(id)
    if (timer) clearTimeout(timer)
    this.progressTimers.delete(id)
    const queue = this.pendingProgress.get(id)
    if (!queue?.length) return
    this.pendingProgress.delete(id)
    try {
      await this.store.transaction((current) => ({
        next: {
          items: (current.items ?? []).map((job) => (job.id === id ? this.applyProgress(job, queue) : job)),
        },
      }))
    } catch (error) {
      this.pendingProgress.set(id, [...queue, ...(this.pendingProgress.get(id) ?? [])])
      throw error
    }
  }

  private async previewWithPending(id: string): Promise<JobRecord | null> {
    const job = (await this.all()).find((item) => item.id === id) ?? null
    if (!job) return null
    return this.applyProgress(job, this.pendingProgress.get(id) ?? [])
  }

  private applyProgress(
    job: JobRecord,
    queue: Array<{
      match: (item: Record<string, unknown>) => boolean
      itemPatch: Record<string, unknown>
      jobPatch: Partial<JobRecord>
    }>
  ): JobRecord {
    if (TERMINAL.includes(job.status)) return job
    let next = { ...job }
    for (const entry of queue) {
      if (TERMINAL.includes(next.status)) break
      const items = next.items.map((item) => (entry.match(item) ? { ...item, ...entry.itemPatch } : item))
      next = { ...next, ...entry.jobPatch, items, ...summarizeJobItems(items), updated_at: Date.now() }
    }
    return next
  }

  private maybeCompact(items: JobRecord[], status?: JobStatus | string): JobRecord[] {
    return status && TERMINAL.includes(status as JobStatus) ? this.compactList(items) : items
  }

  private assertNoActiveConflict(jobs: JobRecord[], lock: JobLock | undefined): void {
    if (!lock) return
    const active = jobs.find((job) => {
      if (!ACTIVE.includes(job.status) || !lock.types.includes(job.type)) return false
      // 资源键优先：跨工作流按底层写入目标是否重叠判定
      if (lock.resourceKeys?.length) return hasResourceConflict(job, lock.resourceKeys)
      return Object.entries(lock.scope ?? {}).every(([key, value]) => String(job.payload?.[key] ?? '') === value)
    })
    if (active) {
      throw new ApiError('batch_job_running', lock.message || 'A batch job is already running for this scope', 409, {
        job_id: active.id,
      })
    }
  }

  /**
   * 压缩任务列表：剥离已完成任务的执行期快照、只保留最近 FINISHED_RETENTION 个已结束任务。
   * 无变化时返回原数组（调用方据此跳过写盘）。
   */
  private compactList(items: JobRecord[]): JobRecord[] {
    const compacted = items.map((job) => (job.status === 'completed' ? stripExecutionSnapshots(job) : job))
    const active = compacted.filter((job) => ACTIVE.includes(job.status))
    const finished = compacted
      .filter((job) => !ACTIVE.includes(job.status))
      .sort((a, b) => (b.finished_at || b.updated_at || b.created_at) - (a.finished_at || a.updated_at || a.created_at))
      .slice(0, FINISHED_RETENTION)
      .sort((a, b) => (a.finished_at || a.updated_at || a.created_at) - (b.finished_at || b.updated_at || b.created_at))
    const result = [...finished, ...active]
    return isSameList(result, items) ? items : result
  }

  private async all(): Promise<JobRecord[]> {
    return (await this.store.read()).items ?? []
  }
}

/** 资源键是否有交集：payload.resource_keys 与目标键集合交叉即冲突 */
function hasResourceConflict(job: JobRecord, resourceKeys: string[]): boolean {
  const existing = job.payload?.resource_keys
  if (!Array.isArray(existing)) return false
  const wanted = new Set(resourceKeys)
  return existing.some((key) => wanted.has(String(key)))
}

/** 两个列表逐项相同时视为无变化 */
function isSameList(left: JobRecord[], right: JobRecord[]): boolean {
  return left.length === right.length && left.every((job, index) => job === right[index])
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
