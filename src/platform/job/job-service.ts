import * as crypto from 'node:crypto'
import { JsonStore } from '../../lib/storage/json-store.js'
import type { JobRecord, JobStatus } from './types.js'
import { ApiError } from '../../lib/http/api-error.js'
import { summarizeJobItems } from './job-summary.js'

export type { JobRecord, JobStatus } from './types.js'

type StoreShape = { items: JobRecord[] }

const ACTIVE: JobStatus[] = ['pending', 'running']
const TERMINAL: JobStatus[] = ['completed', 'failed', 'cancelled']

/** Keep at most this many finished jobs in durable store. */
const FINISHED_RETENTION = 100
/** Progress disk flush coalesce window (ms). Terminal/status changes flush immediately. */
const PROGRESS_FLUSH_MS = 250

/**
 * Generic durable job store (JSON + memory via JsonStore).
 * Domain jobs register runners and share progress/retry semantics.
 *
 * Write model (mainstream small-monolith practice):
 * - durable create / terminal transitions flush immediately
 * - item-level progress is coalesced to reduce O(n) full-file rewrites
 * - finished history is compacted to a retention window
 */
export class JobService {
  private readonly runners = new Map<string, (job: JobRecord) => Promise<void>>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly progressTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly progressFlushes = new Map<string, Promise<void>>()
  private readonly pendingProgress = new Map<
    string,
    {
      match: (item: Record<string, unknown>) => boolean
      itemPatch: Record<string, unknown>
      jobPatch: Partial<JobRecord>
    }[]
  >()
  private resumeStarted = false

  constructor(private readonly store: JsonStore<StoreShape>) {}

  registerRunner(type: string, runner: (job: JobRecord) => Promise<void>): void {
    this.runners.set(type, runner)
  }

  async create(
    type: string,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    options: { start?: boolean; message?: string } = {},
  ): Promise<JobRecord> {
    return this.createExclusive(type, payload, items, undefined, options)
  }

  /** Atomically reject another active job in the same domain scope, then persist the new job. */
  async createExclusive(
    type: string,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    lock: { types: string[]; scope: Record<string, string>; message?: string } | undefined,
    options: { start?: boolean; message?: string } = {},
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
      if (lock) {
        const active = (current.items ?? []).find((candidate) => {
          if (!ACTIVE.includes(candidate.status) || !lock.types.includes(candidate.type)) return false
          const candidatePayload = candidate.payload || {}
          return Object.entries(lock.scope).every(([key, value]) => String(candidatePayload[key] ?? '') === value)
        })
        if (active) {
          throw new ApiError(
            'batch_job_running',
            lock.message || 'A batch job is already running for this scope',
            409,
            { job_id: active.id },
          )
        }
      }
      return { next: { items: this.compactList([...(current.items ?? []), job]) } }
    })

    if (options.start !== false) this.ensureBackground(job.id)
    return job
  }

  async get(id: string): Promise<JobRecord | null> {
    await this.flushProgress(id)
    const job = (await this.all()).find((item) => item.id === id) ?? null
    if (job && ACTIVE.includes(job.status)) this.ensureBackground(job.id)
    return job
  }

  async listActive(type?: string): Promise<JobRecord[]> {
    return (await this.all()).filter((job) => ACTIVE.includes(job.status) && (!type || job.type === type))
  }

  async listByType(type: string, limit = 50): Promise<JobRecord[]> {
    return (await this.all())
      .filter((job) => job.type === type)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit)
  }

  /**
   * Resume pending/running jobs after process restart.
   * Call only after all runners are registered.
   */
  async resumeActiveJobs(): Promise<number> {
    if (this.resumeStarted) return 0
    this.resumeStarted = true

    // One compact pass on boot keeps store size bounded.
    await this.store.transaction((current) => ({
      next: { items: this.compactList(current.items ?? []) },
    }))

    const actives = await this.listActive()
    for (const job of actives) {
      if (job.status === 'running') {
        await this.patch(job.id, {
          status: 'pending',
          message: 'resuming after restart',
        })
      }
      this.ensureBackground(job.id)
    }
    return actives.length
  }

  async patch(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    await this.flushProgress(id)
    let updated: JobRecord | null = null
    await this.store.transaction((current) => {
      const items = (current.items ?? []).map((item) => {
        if (item.id !== id) return item
        updated = {
          ...item,
          ...patch,
          updated_at: Date.now(),
          items: patch.items ?? item.items,
        }
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
    jobPatch: Partial<JobRecord> = {},
  ): Promise<JobRecord | null> {
    // Terminal item results still go through the coalesced writer, but flush soon.
    const queue = this.pendingProgress.get(id) ?? []
    queue.push({ match, itemPatch, jobPatch })
    this.pendingProgress.set(id, queue)

    const immediate =
      TERMINAL.includes(String(jobPatch.status || '') as JobStatus) ||
      ['success', 'failed', 'skipped'].includes(String(itemPatch.status || ''))

    if (immediate) {
      // Coalesce a short burst of item updates then flush.
      this.scheduleProgressFlush(id, 0)
    } else {
      this.scheduleProgressFlush(id, PROGRESS_FLUSH_MS)
    }

    // Return best-effort latest snapshot from memory after applying pending patches in-memory.
    return this.previewWithPending(id)
  }

  /** Re-queue a finished job, optionally enforcing the same domain lock as creation. */
  async requeue(
    id: string,
    patch: Partial<JobRecord> = {},
    lock?: { types: string[]; scope: Record<string, string>; message?: string },
  ): Promise<JobRecord> {
    await this.flushProgress(id)
    let updated: JobRecord | null = null
    await this.store.transaction((current) => {
      const source = (current.items ?? []).find((job) => job.id === id)
      if (!source) throw new ApiError('job_not_found', `Job ${id} not found`, 404)
      if (ACTIVE.includes(source.status)) {
        throw new ApiError('job_running', 'Job is still running', 409, { job_id: id })
      }
      if (lock) {
        const active = (current.items ?? []).find((candidate) => {
          if (candidate.id === id || !ACTIVE.includes(candidate.status) || !lock.types.includes(candidate.type)) {
            return false
          }
          const candidatePayload = candidate.payload || {}
          return Object.entries(lock.scope).every(([key, value]) => String(candidatePayload[key] ?? '') === value)
        })
        if (active) {
          throw new ApiError(
            'batch_job_running',
            lock.message || 'A batch job is already running for this scope',
            409,
            { job_id: active.id },
          )
        }
      }
      updated = {
        ...source,
        status: 'pending',
        finished_at: undefined,
        message: patch.message || 'requeued',
        ...patch,
        updated_at: Date.now(),
      }
      return {
        next: {
          items: (current.items ?? []).map((job) => (job.id === id ? updated! : job)),
        },
      }
    })
    this.ensureBackground(id)
    return updated!
  }

  ensure(id: string): void {
    this.ensureBackground(id)
  }

  /** Stats for health / ops. */
  async stats(): Promise<{ total: number; active: number; finished: number }> {
    const items = await this.all()
    const active = items.filter((j) => ACTIVE.includes(j.status)).length
    return {
      total: items.length,
      active,
      finished: items.length - active,
    }
  }

  private scheduleProgressFlush(id: string, delayMs: number): void {
    const existing = this.progressTimers.get(id)
    if (existing) {
      if (delayMs === 0) {
        clearTimeout(existing)
      } else {
        return
      }
    }
    const timer = setTimeout(() => {
      this.progressTimers.delete(id)
      void this.flushProgress(id).catch(() => {
        // Keep queued progress durable-by-retry without creating an unhandled rejection.
        if (this.pendingProgress.get(id)?.length) this.scheduleProgressFlush(id, PROGRESS_FLUSH_MS)
      })
    }, delayMs)
    // Don't keep process alive solely for progress timers.
    if (typeof timer.unref === 'function') timer.unref()
    this.progressTimers.set(id, timer)
  }

  private flushProgress(id: string): Promise<void> {
    const previous = this.progressFlushes.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => this.flushProgressBatch(id))
    this.progressFlushes.set(id, current)
    void current.finally(() => {
      if (this.progressFlushes.get(id) === current) this.progressFlushes.delete(id)
    }).catch(() => undefined)
    return current
  }

  private async flushProgressBatch(id: string): Promise<void> {
    const timer = this.progressTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.progressTimers.delete(id)
    }
    const queue = this.pendingProgress.get(id)
    if (!queue?.length) return
    // Detach only the batch being flushed. Entries appended while disk I/O is in flight
    // stay in a fresh queue and must not be removed when this flush completes.
    this.pendingProgress.delete(id)

    try {
      await this.store.transaction((current) => {
        const items = (current.items ?? []).map((job) => {
          if (job.id !== id) return job
          let nextItems = job.items
          let nextJob: JobRecord = { ...job }
          for (const entry of queue) {
            nextItems = nextItems.map((item) => (entry.match(item) ? { ...item, ...entry.itemPatch } : item))
            nextJob = {
              ...nextJob,
              ...entry.jobPatch,
              items: nextItems,
            }
          }
          return {
            ...nextJob,
            items: nextItems,
            ...summarizeJobItems(nextItems),
            updated_at: Date.now(),
          }
        })
        return { next: { items } }
      })
    } catch (error) {
      // Restore failed entries ahead of newer ones so no progress transition is lost.
      const newer = this.pendingProgress.get(id) ?? []
      this.pendingProgress.set(id, [...queue, ...newer])
      throw error
    }
    return
  }

  private async previewWithPending(id: string): Promise<JobRecord | null> {
    const base = (await this.all()).find((item) => item.id === id) ?? null
    if (!base) return null
    const queue = this.pendingProgress.get(id)
    if (!queue?.length) return base

    let nextItems = base.items
    let nextJob: JobRecord = { ...base }
    for (const entry of queue) {
      nextItems = nextItems.map((item) => (entry.match(item) ? { ...item, ...entry.itemPatch } : item))
      nextJob = { ...nextJob, ...entry.jobPatch, items: nextItems }
    }
    return {
      ...nextJob,
      items: nextItems,
      ...summarizeJobItems(nextItems),
      updated_at: Date.now(),
    }
  }

  private ensureBackground(jobId: string): void {
    if (this.inflight.has(jobId)) return
    const promise = this.run(jobId)
      .catch(() => undefined)
      .finally(() => this.inflight.delete(jobId))
    this.inflight.set(jobId, promise)
  }

  private async run(jobId: string): Promise<void> {
    await this.flushProgress(jobId)
    const job = await this.get(jobId)
    if (!job) return
    if (!ACTIVE.includes(job.status)) return

    const runner = this.runners.get(job.type)
    if (!runner) {
      await this.patch(jobId, {
        status: 'failed',
        message: `No runner registered for job type: ${job.type}`,
        finished_at: Date.now(),
      })
      return
    }

    await this.patch(jobId, { status: 'running', message: 'running' })
    try {
      const latest = (await this.get(jobId))!
      await runner(latest)
      await this.flushProgress(jobId)
      const after = await this.get(jobId)
      if (after && ACTIVE.includes(after.status)) {
        await this.patch(jobId, {
          status: after.failed > 0 && after.success === 0 ? 'failed' : 'completed',
          done: after.total,
          finished_at: Date.now(),
          message: after.message || 'completed',
        })
      } else {
        // Ensure finished jobs still go through compaction.
        await this.store.transaction((current) => ({
          next: { items: this.compactList(current.items ?? []) },
        }))
      }
    } catch (error) {
      await this.flushProgress(jobId)
      await this.patch(jobId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        finished_at: Date.now(),
      })
    }
  }

  private maybeCompact(items: JobRecord[], status?: JobStatus | string): JobRecord[] {
    if (status && TERMINAL.includes(status as JobStatus)) return this.compactList(items)
    return items
  }

  private compactList(items: JobRecord[]): JobRecord[] {
    const active = items.filter((job) => ACTIVE.includes(job.status))
    const finished = items
      .filter((job) => !ACTIVE.includes(job.status))
      .sort((a, b) => (b.finished_at || b.updated_at || b.created_at) - (a.finished_at || a.updated_at || a.created_at))
      .slice(0, FINISHED_RETENTION)
    // Preserve roughly chronological order: finished (oldest first among retained) then active.
    const finishedAsc = [...finished].sort(
      (a, b) => (a.finished_at || a.updated_at || a.created_at) - (b.finished_at || b.updated_at || b.created_at),
    )
    return [...finishedAsc, ...active]
  }

  private async all(): Promise<JobRecord[]> {
    return (await this.store.read()).items ?? []
  }
}
