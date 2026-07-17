import * as crypto from 'node:crypto'
import { JsonStore } from '../../lib/storage/json-store.js'
import type { JobPort, JobRecord, JobStatus } from '../../contracts/index.js'
import { ApiError } from '../../lib/http/api-error.js'

type StoreShape = { items: JobRecord[] }

const ACTIVE: JobStatus[] = ['pending', 'running']

/**
 * Generic durable job store (JSON + memory via JsonStore).
 * Domain jobs register runners and share progress/retry semantics.
 */
export class JobService implements JobPort {
  private readonly runners = new Map<string, (job: JobRecord) => Promise<void>>()
  private readonly inflight = new Map<string, Promise<void>>()

  constructor(private readonly store = new JsonStore<StoreShape>('jobs/jobs.json', { items: [] })) {}

  registerRunner(type: string, runner: (job: JobRecord) => Promise<void>): void {
    this.runners.set(type, runner)
  }

  async create(
    type: string,
    payload: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
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

    await this.store.transaction((current) => ({
      next: { items: [...(current.items ?? []), job] },
    }))

    if (options.start !== false) this.ensureBackground(job.id)
    return job
  }

  async get(id: string): Promise<JobRecord | null> {
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

  async patch(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    let updated: JobRecord | null = null
    await this.store.transaction((current) => ({
      next: {
        items: (current.items ?? []).map((item) => {
          if (item.id !== id) return item
          updated = {
            ...item,
            ...patch,
            updated_at: Date.now(),
            items: patch.items ?? item.items,
          }
          return updated
        }),
      },
    }))
    return updated
  }

  async patchItem(
    id: string,
    match: (item: Record<string, unknown>) => boolean,
    itemPatch: Record<string, unknown>,
    jobPatch: Partial<JobRecord> = {},
  ): Promise<JobRecord | null> {
    let updated: JobRecord | null = null
    await this.store.transaction((current) => ({
      next: {
        items: (current.items ?? []).map((job) => {
          if (job.id !== id) return job
          const items = job.items.map((item) => (match(item) ? { ...item, ...itemPatch } : item))
          const done = items.filter((i) => ['success', 'failed', 'skipped'].includes(String(i.status))).length
          const success = items.filter((i) => i.status === 'success').length
          const failed = items.filter((i) => i.status === 'failed').length
          const skipped = items.filter((i) => i.status === 'skipped').length
          updated = {
            ...job,
            ...jobPatch,
            items,
            done,
            success,
            failed,
            skipped,
            updated_at: Date.now(),
          }
          return updated
        }),
      },
    }))
    return updated
  }

  /** Re-queue a finished job (e.g. retry failed items already rewritten as pending). */
  async requeue(id: string, patch: Partial<JobRecord> = {}): Promise<JobRecord> {
    const job = await this.get(id)
    if (!job) throw new ApiError('job_not_found', `Job ${id} not found`, 404)
    if (ACTIVE.includes(job.status)) {
      throw new ApiError('job_running', 'Job is still running', 409, { job_id: id })
    }
    const updated = await this.patch(id, {
      status: 'pending',
      finished_at: undefined,
      message: patch.message || 'requeued',
      ...patch,
    })
    this.ensureBackground(id)
    return updated!
  }

  ensure(id: string): void {
    this.ensureBackground(id)
  }

  private ensureBackground(jobId: string): void {
    if (this.inflight.has(jobId)) return
    const promise = this.run(jobId)
      .catch(() => undefined)
      .finally(() => this.inflight.delete(jobId))
    this.inflight.set(jobId, promise)
  }

  private async run(jobId: string): Promise<void> {
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
      const after = await this.get(jobId)
      if (after && ACTIVE.includes(after.status)) {
        await this.patch(jobId, {
          status: after.failed > 0 && after.success === 0 ? 'failed' : 'completed',
          done: after.total,
          finished_at: Date.now(),
          message: after.message || 'completed',
        })
      }
    } catch (error) {
      await this.patch(jobId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        finished_at: Date.now(),
      })
    }
  }

  private async all(): Promise<JobRecord[]> {
    return (await this.store.read()).items ?? []
  }
}
