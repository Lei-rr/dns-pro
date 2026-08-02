import { ApiError } from '../../shared/http/api-error.js'
import type { JobService } from './job.service.js'
import type { JobRecord } from './job.types.js'
import { summarizeJobItems } from './job-summary.js'

/** Shared batch job fields presented to API clients. */
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
  items: Array<Record<string, unknown>>
  created_at: number
  updated_at: number
  finished_at?: number
}

export type BatchItemResult = {
  status: 'success' | 'failed' | 'skipped'
  message?: string
  extra?: Record<string, unknown>
}

/**
 * Finish a batch job from item counters (shared CN message template).
 */
export async function finishBatchJob(jobs: JobService, jobId: string, label: string): Promise<JobRecord | null> {
  const finalJob = await jobs.get(jobId)
  if (!finalJob) return null
  const { success, failed, skipped } = summarizeJobItems(finalJob.items)
  return jobs.patch(jobId, {
    status: failed > 0 ? 'failed' : 'completed',
    success,
    failed,
    skipped,
    done: finalJob.items.length,
    current: undefined,
    finished_at: Date.now(),
    message: failed
      ? `${label}完成：成功 ${success}，失败 ${failed}，跳过 ${skipped}`
      : `${label}完成：成功 ${success}，跳过 ${skipped}`,
  })
}

/**
 * Find an active job among `types` whose payload matches all `scope` key/value pairs.
 */
export async function findActiveBatchJob(
  jobs: JobService,
  types: string[],
  scope: Record<string, string>
): Promise<JobRecord | null> {
  const actives: JobRecord[] = []
  for (const type of types) {
    actives.push(...(await jobs.listActive(type)))
  }
  return (
    actives.find((job) => {
      const payload = job.payload || {}
      return Object.entries(scope).every(([key, value]) => String(payload[key] ?? '') === value)
    }) ?? null
  )
}

export async function assertNoActiveBatchJob(
  jobs: JobService,
  types: string[],
  scope: Record<string, string>,
  message = 'A batch job is already running for this zone'
): Promise<void> {
  const active = await findActiveBatchJob(jobs, types, scope)
  if (active) {
    throw new ApiError('batch_job_running', message, 409, { job_id: active.id })
  }
}

/**
 * Re-queue failed items as pending (shared counters).
 */
export async function requeueFailedBatchItems(
  jobs: JobService,
  job: JobRecord,
  lock: { types: string[]; scope: Record<string, string>; message?: string },
  message = '失败项重试中'
): Promise<JobRecord> {
  const failed = job.items.filter((i) => i.status === 'failed')
  if (!failed.length) throw new ApiError('batch_no_failed', 'No failed items to retry', 422)

  const items = job.items.map((item) =>
    item.status === 'failed'
      ? { ...item, status: 'pending', message: undefined, attempt: Number(item.attempt || 0) + 1 }
      : item
  )
  const summary = summarizeJobItems(items)
  return jobs.requeue(
    job.id,
    {
      items,
      ...summary,
      message,
    },
    lock
  )
}

/**
 * Sequential item loop used by SaaS / EdgeOne / DNS batch runners.
 */
export async function runBatchItems(
  jobs: JobService,
  job: JobRecord,
  options: {
    itemKey: (item: Record<string, unknown>) => string
    runningMessage: string
    progressMessage: string
    /** Override progress cursor (defaults to item key). */
    progressCurrent?: (item: Record<string, unknown>, key: string) => string
    execute: (item: Record<string, unknown>, key: string) => Promise<BatchItemResult>
    /** When true, empty keys are skipped silently (default). */
    skipEmptyKey?: boolean
  }
): Promise<void> {
  for (const raw of job.items) {
    const item = raw as Record<string, unknown>
    const key = options.itemKey(item)
    if ((!key && options.skipEmptyKey !== false) || item.status === 'success' || item.status === 'skipped') {
      continue
    }

    const current = options.progressCurrent ? options.progressCurrent(item, key) : key
    const claim = await jobs.beginItemExecution(job.id, (row) => options.itemKey(row) === key, options.runningMessage, {
      current,
      message: options.progressMessage,
    })
    if (claim.state !== 'execute') continue
    const executionItem = claim.item

    try {
      const result = await options.execute(executionItem, key)
      await jobs.patchItem(job.id, (row) => options.itemKey(row) === key, {
        status: result.status,
        message: result.message,
        ...(result.extra ?? {}),
      })
    } catch (error) {
      await jobs.patchItem(job.id, (row) => options.itemKey(row) === key, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/** Map JobRecord → API view skeleton; caller merges domain payload fields. */
export function presentBatchJobBase(job: JobRecord): BatchJobViewBase {
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
    payload: job.payload || {},
    items: job.items.map(({ operation_id: _operationId, attempt: _attempt, item_key: _itemKey, ...item }) => item),
    created_at: job.created_at,
    updated_at: job.updated_at,
    finished_at: job.finished_at,
  }
}

export function dedupeStrings(
  values: string[],
  normalize: (v: string) => string = (v) => v.trim().toLowerCase()
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values || []) {
    const value = normalize(String(raw || ''))
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
