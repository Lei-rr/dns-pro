#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../server/src/kernel/store/json-store.js'
import { JobService } from '../server/src/kernel/jobs/job.service.js'
import { runBatchItems } from '../server/src/kernel/jobs/batch-job.js'
import { summarizeJobItems } from '../server/src/kernel/jobs/job.types.js'
import { invalidateProviderCache, withProviderCache } from '../server/src/kernel/cache/provider-cache.js'

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

  // Invalidation during a load fences off its stale result. Calls started after
  // invalidation must not join the stale in-flight promise.
  const fencedKey = 'probe:invalidation-fence'
  const fencedTag = 'probe:fence'
  const staleRelease = deferred<string>()
  let fencedLoaderCalls = 0
  const staleRead = withProviderCache({
    key: fencedKey,
    tags: [fencedTag],
    loader: async () => {
      fencedLoaderCalls++
      return staleRelease.promise
    },
  })
  invalidateProviderCache({ tags: [fencedTag] })
  const freshRead = withProviderCache({
    key: fencedKey,
    tags: [fencedTag],
    loader: async () => {
      fencedLoaderCalls++
      return 'fresh'
    },
  })
  staleRelease.resolve('stale')
  assert.equal((await staleRead).value, 'stale')
  assert.equal((await freshRead).value, 'fresh', 'post-invalidation caller joined stale in-flight work')
  const freshAfterInvalidation = await withProviderCache({
    key: fencedKey,
    tags: [fencedTag],
    loader: async () => 'must-not-run',
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

  const jobs = new JobService()
  let runnerCalls = 0
  const runnerStarted = deferred<void>()
  const release = deferred<void>()
  jobs.registerRunner('once', async () => {
    runnerCalls++
    runnerStarted.resolve()
    await release.promise
  })
  const once = await jobs.create('once', {}, [{ key: 'x' }], { start: false })
  // get() 会触发后台启动：重复调用必须被 inflight 去重
  void jobs.get(once.id)
  void jobs.get(once.id)
  await runnerStarted.promise
  assert.equal(runnerCalls, 1, 'inflight map allowed duplicate execution')
  release.resolve()
  await jobs.drain()
  assert.equal((await jobs.get(once.id))?.status, 'completed')

  // Closing waits for a running job to finish and settle its terminal state in memory.
  const closingJobs = new JobService()
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
    (await closingJobs.get(closing.id))?.status,
    'completed',
    'close returned before the terminal job state was set'
  )

  // An item left in running state is uncertain: its side effect is not replayed.
  const uncertainJobs = new JobService()
  const effects: string[] = []
  uncertainJobs.registerRunner('uncertain', async (job) => {
    await runBatchItems(uncertainJobs, job, {
      itemKey: (item) => String(item.key),
      runningMessage: 'running',
      progressMessage: 'running',
      execute: async (_item, key) => {
        effects.push(key)
        return { status: 'success' }
      },
    })
  })
  const uncertain = await uncertainJobs.create(
    'uncertain',
    {},
    [
      { key: 'uncertain', status: 'running' },
      { key: 'pending', status: 'pending' },
    ],
    { start: false }
  )
  await uncertainJobs.get(uncertain.id)
  await uncertainJobs.drain()
  const settled = await uncertainJobs.get(uncertain.id)
  assert.deepEqual(effects, ['pending'])
  assert.equal(settled?.status, 'failed')
  assert.equal(settled?.items[0]?.status, 'failed')
  assert.match(String(settled?.items[0]?.message), /待确认/)

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

  assert.deepEqual(summarizeJobItems([{ status: 'failed' }, { status: 'success' }]), {
    done: 2,
    success: 1,
    failed: 1,
    skipped: 0,
  })

  assert.throws(() => new JsonStore('../escaped.json', {}, dataDir), /data root/)
  assert.throws(() => new JsonStore(path.join(dataDir, 'absolute.json'), {}, dataDir), /relative to data root/)
  console.log('platform-concurrency-probe=ok')
} finally {
  await fs.rm(dataDir, { recursive: true, force: true })
}
