#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../src/platform/storage/json-store.js'
import { JobService, type JobRecord } from '../src/platform/jobs/job.service.js'
import { runBatchItems } from '../src/platform/jobs/batch-helpers.js'
import { summarizeJobItems } from '../src/platform/jobs/job-summary.js'
import { invalidateProviderCache, withProviderCache } from '../src/platform/cache/provider-cache.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-platform-probe-'))
try {
  // Separate JsonStore instances for one absolute path share one process queue.
  const left = new JsonStore<{ value: number }>('counter.json', { value: 0 }, dataDir)
  const right = new JsonStore<{ value: number }>('counter.json', { value: 0 }, dataDir)
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      (index % 2 ? left : right).transaction((current) => ({ next: { value: current.value + 1 } }))
    )
  )
  assert.equal((await left.readFresh()).value, 20)
  await fs.writeFile(path.join(dataDir, 'counter.json'), '{"value":21}\n')
  assert.equal((await right.readFresh()).value, 21, 'fresh read did not observe disk truth')

  // Concurrent cold reads for one key share one provider call and one result.
  const cacheLoaderRelease = deferred<string>()
  let cacheLoaderCalls = 0
  const loadCached = () =>
    withProviderCache({
      key: 'probe:cold-single-flight',
      loader: async () => {
        cacheLoaderCalls++
        return cacheLoaderRelease.promise
      },
    })
  const cachedReads = [loadCached(), loadCached()]
  assert.equal(cacheLoaderCalls, 1, 'concurrent cold cache reads called the loader more than once')
  cacheLoaderRelease.resolve('shared')
  const [firstCached, secondCached] = await Promise.all(cachedReads)
  assert.deepEqual(secondCached, firstCached, 'concurrent cold cache reads returned different results')

  // Failed loads leave no stale single-flight entry and can be retried.
  const failedKey = 'probe:failed-single-flight'
  let failedLoaderCalls = 0
  const failure = new Error('expected cache loader failure')
  const failedLoad = () =>
    withProviderCache({
      key: failedKey,
      loader: async () => {
        failedLoaderCalls++
        throw failure
      },
    })
  const failedReads = await Promise.allSettled([failedLoad(), failedLoad()])
  assert.equal(failedLoaderCalls, 1, 'concurrent failed cache reads called the loader more than once')
  assert(failedReads.every((result) => result.status === 'rejected' && result.reason === failure))
  const retried = await withProviderCache({ key: failedKey, loader: async () => ++failedLoaderCalls })
  assert.equal(retried.value, 2, 'failed cache load could not be retried')

  // Invalidation during a load fences off its stale result, including for joined callers.
  const fencedKey = 'probe:invalidation-fence'
  const fencedTag = 'probe:fence'
  const staleRelease = deferred<string>()
  let fencedLoaderCalls = 0
  const staleReads = [
    withProviderCache({
      key: fencedKey,
      tags: [fencedTag],
      loader: async () => {
        fencedLoaderCalls++
        return staleRelease.promise
      },
    }),
    withProviderCache({ key: fencedKey, tags: [fencedTag], loader: async () => 'must-not-run' }),
  ]
  invalidateProviderCache({ tags: [fencedTag] })
  staleRelease.resolve('stale')
  assert.deepEqual(
    (await Promise.all(staleReads)).map((result) => result.value),
    ['stale', 'stale']
  )
  const freshAfterInvalidation = await withProviderCache({
    key: fencedKey,
    tags: [fencedTag],
    loader: async () => {
      fencedLoaderCalls++
      return 'fresh'
    },
  })
  assert.equal(freshAfterInvalidation.value, 'fresh', 'invalidation allowed an old inflight result to refill cache')
  assert.equal(fencedLoaderCalls, 2)

  // Explicit refresh keeps bypassing both the cached value and a cold single-flight.
  const refreshKey = 'probe:refresh-bypass'
  const coldRelease = deferred<string>()
  let refreshLoaderCalls = 0
  const coldRead = withProviderCache({
    key: refreshKey,
    loader: async () => {
      refreshLoaderCalls++
      return coldRelease.promise
    },
  })
  const refreshed = await withProviderCache({
    key: refreshKey,
    refresh: true,
    loader: async () => {
      refreshLoaderCalls++
      return 'refreshed'
    },
  })
  coldRelease.resolve('cold')
  await coldRead
  assert.equal(refreshed.value, 'refreshed')
  assert.equal(refreshLoaderCalls, 2, 'refresh joined a cold single-flight instead of bypassing it')

  const jobs = new JobService(new JsonStore('jobs/jobs.json', { items: [] }, dataDir))
  let runnerCalls = 0
  const runnerStarted = deferred<void>()
  const release = deferred<void>()
  jobs.registerRunner('once', async () => {
    runnerCalls++
    runnerStarted.resolve()
    await release.promise
  })
  const once = await jobs.create('once', {}, [{ key: 'x' }], { start: false })
  jobs.ensure(once.id)
  jobs.ensure(once.id)
  await runnerStarted.promise
  assert.equal(runnerCalls, 1, 'inflight map allowed duplicate execution')
  release.resolve()
  await jobs.drain()
  assert.equal((await jobs.get(once.id))?.status, 'completed')

  // Closing waits for a running job to finish and persist its terminal state.
  const closeStore = new JsonStore<{ items: JobRecord[] }>('jobs/close.json', { items: [] }, dataDir)
  const closingJobs = new JobService(closeStore)
  const closeRunnerStarted = deferred<void>()
  const releaseCloseRunner = deferred<void>()
  closingJobs.registerRunner('close', async () => {
    closeRunnerStarted.resolve()
    await releaseCloseRunner.promise
  })
  const closing = await closingJobs.create('close', {}, [{ key: 'x' }])
  await closeRunnerStarted.promise
  const closeResult = closingJobs.close().then(() => 'closed' as const)
  const closeBeforeRelease = await Promise.race([
    closeResult,
    new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 30)),
  ])
  releaseCloseRunner.resolve()
  await closeResult
  assert.equal(closeBeforeRelease, 'waiting', 'close returned before the running runner settled')
  assert.equal(
    (await closeStore.readFresh()).items.find((job) => job.id === closing.id)?.status,
    'completed',
    'close returned before the terminal job state was durable'
  )

  // A durable running item is uncertain after restart and its side effect is not replayed.
  const recoveryStore = new JsonStore('jobs/recovery.json', { items: [] }, dataDir)
  const creator = new JobService(recoveryStore)
  const recovering = await creator.create(
    'recover',
    {},
    [
      { key: 'uncertain', status: 'running', operation_id: 'kept-operation' },
      { key: 'pending', status: 'pending' },
    ],
    { start: false }
  )
  const effects: string[] = []
  const resumed = new JobService(new JsonStore('jobs/recovery.json', { items: [] }, dataDir))
  resumed.registerRunner('recover', async (job) => {
    await runBatchItems(resumed, job, {
      itemKey: (item) => String(item.key),
      runningMessage: 'running',
      progressMessage: 'running',
      execute: async (_item, key) => {
        effects.push(key)
        return { status: 'success' }
      },
    })
  })
  assert.equal(await resumed.resumeActiveJobs(), 1)
  await resumed.drain()
  const recovered = await resumed.get(recovering.id)
  assert.deepEqual(effects, ['pending'])
  assert.equal(recovered?.status, 'failed')
  assert.equal(recovered?.items[0]?.status, 'failed')
  assert.equal(recovered?.items[0]?.operation_id, 'kept-operation')

  const terminal = await jobs.createTerminalExclusive('terminal', {}, [{ key: 'x', status: 'success' }], undefined, {
    status: 'completed',
    success: 1,
    failed: 0,
    skipped: 0,
    message: 'done',
  })
  assert.equal(await jobs.patch(terminal.id, { status: 'failed' }), null)
  await jobs.patchItem(terminal.id, () => true, { status: 'failed' }, { status: 'running' })
  await jobs.drain()
  assert.equal((await jobs.get(terminal.id))?.status, 'completed')

  const pending = await jobs.create('summary', {}, [{ status: 'failed' }, { status: 'success' }], { start: false })
  const completed = await jobs.completePending(pending.id, { status: 'failed', ...summarizeJobItems(pending.items) })
  assert.equal(completed?.failed, 1)

  assert.throws(() => new JsonStore('../escaped.json', {}, dataDir), /data root/)
  assert.throws(() => new JsonStore(path.join(dataDir, 'absolute.json'), {}, dataDir), /relative to data root/)
  console.log('platform-concurrency-probe=ok')
} finally {
  await fs.rm(dataDir, { recursive: true, force: true })
}
