import type { JobRecord } from './types.js'

export type JobItemSummary = Pick<JobRecord, 'done' | 'success' | 'failed' | 'skipped'>

export function summarizeJobItems(items: Array<Record<string, unknown>>): JobItemSummary {
  let success = 0
  let failed = 0
  let skipped = 0

  for (const item of items) {
    if (item.status === 'success') success++
    else if (item.status === 'failed') failed++
    else if (item.status === 'skipped') skipped++
  }

  return {
    done: success + failed + skipped,
    success,
    failed,
    skipped,
  }
}
