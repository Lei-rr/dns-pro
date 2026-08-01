#!/usr/bin/env node
import assert from 'node:assert/strict'
import { runBatchJob } from '../web/src/shared/job/model/run-batch-job.js'
import { useJobProgress } from '../web/src/shared/job/model/use-job-progress.js'
import type { JobLike } from '../web/src/shared/job/model/types.js'
import { useRowBusy } from '../web/src/shared/lib/row-busy.js'
import { selectableRowKeys, selectedAvailableRows } from '../web/src/shared/lib/row-selection.js'
import { createScopeGeneration } from '../web/src/shared/lib/scope-generation.js'
import { confirmState, settleConfirm } from '../web/src/shared/ui/confirm/confirm.js'

Object.assign(globalThis, {
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, message: string) {
  // Product polling defaults to 1000ms; allow three complete intervals under full verify load.
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(message)
}

// Dialog/list actions capture an immutable scope before confirmation. A route
// switch invalidates that owner, so a late confirmation cannot POST or mutate UI.
const scopeGeneration = createScopeGeneration()
const capturedScope = scopeGeneration.capture({ providerId: 'provider-a', zoneName: 'zone-a' })
const confirmation = deferred<boolean>()
let scopedPosts = 0
let scopedToasts = 0
let scopedMutations = 0
const staleScopedAction = (async () => {
  if (!(await confirmation.promise) || !capturedScope.active()) return
  scopedPosts++
  await Promise.resolve()
  if (!capturedScope.active()) return
  scopedToasts++
  scopedMutations++
})()
scopeGeneration.invalidate()
const replacementScope = scopeGeneration.capture({ providerId: 'provider-b', zoneName: 'zone-b' })
confirmation.resolve(true)
await staleScopedAction
assert.equal(capturedScope.active(), false)
assert.deepEqual(capturedScope.value, { providerId: 'provider-a', zoneName: 'zone-a' })
assert.equal(replacementScope.active(), true)
assert.deepEqual(replacementScope.value, { providerId: 'provider-b', zoneName: 'zone-b' })
assert.equal(scopedPosts, 0, 'stale scope confirmation issued POST')
assert.equal(scopedToasts, 0, 'stale scope action emitted toast')
assert.equal(scopedMutations, 0, 'stale scope action mutated replacement list')

// Exclusive scoped claims snapshot their values and invalidate the previous
// operation, which is required by dialog save/delete/load and form submissions.
const exclusiveScope = createScopeGeneration()
const mutableScope = { providerId: 'provider-a', zoneName: 'zone-a' }
const firstClaim = exclusiveScope.claim(mutableScope)
mutableScope.providerId = 'mutated-provider'
const secondClaim = exclusiveScope.claim({ providerId: 'provider-b', zoneName: 'zone-b' })
assert.equal(firstClaim.active(), false)
assert.deepEqual(firstClaim.value, { providerId: 'provider-a', zoneName: 'zone-a' })
assert.equal(secondClaim.active(), true)
assert.deepEqual(secondClaim.value, { providerId: 'provider-b', zoneName: 'zone-b' })

const inFlightScope = createScopeGeneration()
const inFlightOwner = inFlightScope.capture({ providerId: 'provider-a', zoneName: 'zone-a' })
const postResponse = deferred<void>()
let inFlightToasts = 0
let inFlightMutations = 0
const inFlightAction = (async () => {
  await postResponse.promise
  if (!inFlightOwner.active()) return
  inFlightToasts++
  inFlightMutations++
})()
inFlightScope.invalidate()
postResponse.resolve()
await inFlightAction
assert.equal(inFlightToasts, 0, 'stale in-flight response emitted toast')
assert.equal(inFlightMutations, 0, 'stale in-flight response mutated replacement list')

const progress = useJobProgress()
const oldActive = deferred<{ data: JobLike }>()
const oldResume = progress.resumeActive(() => oldActive.promise, {
  label: '旧任务',
  intervalMs: 300,
  autoClearMs: 0,
  fetchJob: async () => ({ id: 'old', status: 'completed', message: '旧任务完成' }),
})

const owner = progress.begin()
const newPoll = progress.pollJob(
  'new',
  {
    label: '新任务',
    intervalMs: 300,
    autoClearMs: 0,
    fetchJob: async () => ({ id: 'new', status: 'completed', message: '新任务完成', done: 1, total: 1 }),
  },
  owner
)

oldActive.resolve({ data: { id: 'old', status: 'running', done: 0, total: 1 } })
assert.equal(await oldResume, null)
const finished = await newPoll
assert.equal(finished?.id, 'new')
assert.equal(progress.job.value?.id, 'new')
assert.equal(progress.text.value, '新任务完成')
assert.equal(progress.running.value, false)
assert.equal(progress.owns(owner), true)

const staleOwner = owner
progress.reset()
assert.equal(progress.owns(staleOwner), false)
assert.equal(progress.job.value, null)
assert.equal(progress.text.value, '')

// reset during the polling sleep must prevent the fetch scheduled after that
// sleep; zero requests may escape after ownership is invalidated.
const sleepingProgress = useJobProgress()
let fetchesAfterReset = 0
const sleepingOwner = sleepingProgress.begin()
const sleepingPoll = sleepingProgress.pollJob(
  'sleeping',
  {
    intervalMs: 300,
    autoClearMs: 0,
    fetchJob: async () => {
      fetchesAfterReset++
      return { id: 'sleeping', status: 'completed' }
    },
  },
  sleepingOwner
)
await new Promise((resolve) => setTimeout(resolve, 20))
sleepingProgress.reset()
assert.equal(await sleepingPoll, null)
assert.equal(fetchesAfterReset, 0, 'reset polling owner still fetched after sleep')

const selectableRows = [{ id: 'ready-a' }, { id: 'busy' }, { id: 'ready-b' }]
const busyRows = new Set(['busy'])
assert.deepEqual(
  selectableRowKeys(
    selectableRows,
    (row) => row.id,
    (row) => busyRows.has(row.id)
  ),
  ['ready-a', 'ready-b']
)
assert.deepEqual(
  selectedAvailableRows(
    selectableRows,
    ['ready-a', 'busy'],
    (row) => row.id,
    (row) => busyRows.has(row.id)
  ),
  [{ id: 'ready-a' }]
)

const rowBusy = useRowBusy()
const rowA = deferred<void>()
const rowB = deferred<void>()
let duplicateCalls = 0
let oldOwnerActive = true
const taskA = rowBusy.runBusy('a', async (owner) => {
  await rowA.promise
  oldOwnerActive = owner.active()
})
const duplicateA = rowBusy.runBusy('a', async () => {
  duplicateCalls++
})
const taskB = rowBusy.runBusy('b', async () => rowB.promise)
await Promise.resolve()
assert.equal(rowBusy.isBusy('a'), true)
assert.equal(rowBusy.isBusy('b'), true)
assert.equal(duplicateCalls, 0)
rowBusy.reset()
const newRowA = deferred<void>()
const newTaskA = rowBusy.runBusy('a', async () => newRowA.promise)
assert.equal(rowBusy.isBusy('a'), true)
rowA.resolve()
await Promise.all([taskA, duplicateA])
assert.equal(oldOwnerActive, false)
assert.equal(rowBusy.isBusy('a'), true, 'stale finally cleared the new scope owner')
assert.equal(rowBusy.isBusy('b'), false)
newRowA.resolve()
rowB.resolve()
await Promise.all([newTaskA, taskB])
assert.deepEqual(rowBusy.busyKeys.value, [])

// A failed-job confirmation belongs to the scope which opened it. Once reset,
// confirming that stale dialog must not retry, clear selection, or reload.
const batchProgress = useJobProgress()
let retryCalls = 0
let clearCalls = 0
let doneCalls = 0
const staleBatch = runBatchJob({
  label: '旧 scope 批量',
  create: async () => ({ data: { id: 'stale-job' } }),
  fetchJob: async () => ({
    id: 'stale-job',
    status: 'failed',
    message: '旧任务失败',
    items: [{ id: 'failed-item', status: 'failed', message: '失败' }],
  }),
  retry: async () => {
    retryCalls++
  },
  clearSelection: () => {
    clearCalls++
  },
  onDone: async () => {
    doneCalls++
  },
  jobProgress: batchProgress,
})
await waitFor(() => confirmState.hasPending(), 'failed-job confirmation did not open')
batchProgress.reset()
settleConfirm(true)
assert.equal(await staleBatch, null)
assert.equal(retryCalls, 0, 'stale confirmation issued retry POST')
assert.equal(clearCalls, 0, 'stale confirmation cleared the new scope selection')
assert.equal(doneCalls, 0, 'stale confirmation reloaded the new scope')

console.log('job-progress-probe=ok')
