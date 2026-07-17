import * as crypto from 'node:crypto'
import { JsonStore } from '../../lib/storage/json-store.js'
import type { JobPort, JobRecord, JobStatus } from '../../contracts/index.js'
import { ApiError } from '../../lib/http/api-error.js'

type StoreShape = { items: JobRecord[] }

const ACTIVE: JobStatus[] = ['pending', 'running']

/**
 * Generic durable job store (JSON + memory via JsonStore).
 * Domain jobs (preferred-apply, future batch sync) should build on this.
 */
export class JobService implements JobPort {
  private readonly runners = new Map<string, (job: JobRecord) => Promise<void>>()
  private readonly inflight = new Map<string, Promise<void>>()

  constructor(private readonly store = new JsonStore<StoreShape>('jobs/jobs.json', { items: [] })) {}

  /** Register a runner for a job type. */
  registerRunner(type: string, runner: (job: JobRecord) => Promise<void>): void {
    this.runners.set(type, runner)
  }

  async create(type: string, payload: Record<string, unknown>, items: Array<Record<string, unknown>>): Promise<JobRecord> {
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
      message: 'pending',
    }

    await this.store.transaction((current) => ({
      next: { items: [...(current.items ?? []), job] },
    }))
    this.ensureBackground(job.id)
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

  async patch(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    let updated: JobRecord | null = null
    await this.store.transaction((current) => ({
      next: {
        items: (current.items ?? []).map((item) => {
          if (item.id !== id) return item
          updated = { ...item, ...patch, updated_at: Date.now() }
          return updated
        }),
      },
    }))
    return updated
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
      if (error instanceof ApiError) throw error
    }
  }

  private async all(): Promise<JobRecord[]> {
    return (await this.store.read()).items ?? []
  }
}
