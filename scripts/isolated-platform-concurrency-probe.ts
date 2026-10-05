#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../server/core/store/json-store.js'
import { JobService } from '../server/core/jobs/job.service.js'
import { BatchJobKind, runBatchItems } from '../server/core/jobs/batch-job.js'
import { summarizeJobItems } from '../server/core/jobs/job.types.js'
import {
  DNS_BATCH_CREATE_JOB,
  SAAS_BATCH_DELETE_JOB,
  dnsZoneKey,
  peekResourceKeys,
  readResourceKeys,
} from '../server/core/jobs/job-registry.js'
import { ApiError } from '../server/core/http/api-error.js'
import { invalidateProviderCache, withProviderCache } from '../server/core/cache/provider-cache.js'

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

  // 互斥判定只有一份：面板反查（active）与创建路径同口径——同一互斥范围（lockTypes）+ 资源键交集，
  // 判定统一由 JobService.findActiveConflict 给出，跨工作流命中同一底层资源时两边结论必须一致。
  const lockJobs = new JobService()
  const lockKind = new BatchJobKind<string>(lockJobs, {
    types: [DNS_BATCH_CREATE_JOB],
    lockTypes: [DNS_BATCH_CREATE_JOB, SAAS_BATCH_DELETE_JOB],
    scopeKeys: ['provider_id', 'zone'],
    resourceKeys: readResourceKeys,
    present: (job) => job.id,
  })
  const saasKind = new BatchJobKind<string>(lockJobs, {
    types: [SAAS_BATCH_DELETE_JOB],
    lockTypes: [DNS_BATCH_CREATE_JOB, SAAS_BATCH_DELETE_JOB],
    scopeKeys: ['provider_id', 'zone_name'],
    resourceKeys: readResourceKeys,
    present: (job) => job.id,
  })
  // SaaS 批量任务与 DNS 批量写同一底层 Cloudflare 站点，但它的 payload 只有 provider_id / zone_name
  const saasJob = await lockJobs.create(
    SAAS_BATCH_DELETE_JOB,
    { provider_id: 'cf-1', zone_name: 'example.com', resource_keys: ['dns:cloudflare:cf-1:example.com'] },
    [{ hostname: 'a.example.com' }],
    { start: false }
  )
  const sharedZoneKeys = [dnsZoneKey('cloudflare', 'cf-1', 'example.com')]
  // 别族任务必须出现在本族反查结果里：两族写的是同一底层站点，反查说「没有作业」而创建被 409 就是口径分叉
  assert.equal(
    await lockKind.active({ provider_type: 'cloudflare', provider_id: 'cf-1', zone: 'example.com' }, sharedZoneKeys),
    saasJob.id,
    '同一底层资源上的跨工作流活跃任务必须被本族反查命中'
  )
  // 创建路径与反查同源：资源键与活跃任务有交集时仍被 409 拒绝（同一份判定函数）
  await assert.rejects(
    () =>
      lockJobs.createExclusive(
        DNS_BATCH_CREATE_JOB,
        {
          provider_type: 'cloudflare',
          provider_id: 'cf-1',
          zone: 'example.com',
          resource_keys: ['dns:cloudflare:cf-1:example.com'],
        },
        [],
        lockKind.lock({
          provider_type: 'cloudflare',
          provider_id: 'cf-1',
          zone: 'example.com',
          resource_keys: ['dns:cloudflare:cf-1:example.com'],
        }),
        { start: false }
      ),
    (error: unknown) => error instanceof ApiError && error.code === 'batch_job_running',
    '同一底层站点上的跨工作流任务必须仍在创建路径被 409 拒绝'
  )
  // 本族面板：反查命中后，同 providerId 的详情端点必须能取到本族任务
  const saasActiveId = await saasKind.active({ provider_id: 'cf-1', zone_name: 'example.com' }, sharedZoneKeys)
  assert.equal(saasActiveId, saasJob.id, 'SaaS 面板必须能反查到本族活跃任务')
  assert.equal(
    await saasKind.find(String(saasActiveId), { provider_id: 'cf-1' }),
    saasJob.id,
    '本族任务必须能被同 providerId 的详情端点取到'
  )
  assert.equal(
    await saasKind.find(String(saasActiveId), { provider_id: 'cf-2' }),
    null,
    '别族服务商的详情端点仍必须取不到该任务'
  )

  // 服务商/站点刻意用独立取值，避免干扰后面「历史 payload 重试」的 scope 判定
  const dnsJob = await lockJobs.create(
    DNS_BATCH_CREATE_JOB,
    {
      provider_type: 'dnspod',
      provider_id: 'dns-2',
      zone: 'locks.example.com',
      resource_keys: ['dns:dnspod:dns-2:locks.example.com'],
    },
    [{ name: 'www', type: 'A', value: '192.0.2.1' }],
    { start: false }
  )
  const dnsActiveId = await lockKind.active(
    { provider_type: 'dnspod', provider_id: 'dns-2', zone: 'locks.example.com' },
    [dnsZoneKey('dnspod', 'dns-2', 'locks.example.com')]
  )
  assert.equal(dnsActiveId, dnsJob.id, '本族活跃任务必须能被面板反查命中')
  assert.equal(
    await lockKind.active({ provider_type: 'dnspod', provider_id: 'dns-2', zone: 'other.example.com' }, [
      dnsZoneKey('dnspod', 'dns-2', 'other.example.com'),
    ]),
    null,
    '同一服务商的不同站点不得误报为活跃冲突'
  )
  assert.equal(
    await lockKind.active({ provider_type: 'dnspod', provider_id: 'dns-3', zone: 'locks.example.com' }, [
      dnsZoneKey('dnspod', 'dns-3', 'locks.example.com'),
    ]),
    null,
    '不同服务商的同名站点不得误报为活跃冲突'
  )
  assert.equal(
    await lockKind.find(String(dnsActiveId), { provider_id: 'dns-2' }),
    dnsJob.id,
    '反查返回的每个任务 id 都必须能被同 providerId 的详情端点取到'
  )

  // 资源键缺失属于装配错误：创建路径必须显式失败，查询路径不得因此 500
  assert.throws(
    () => readResourceKeys({ provider_id: 'cf-1' }),
    (error: unknown) => error instanceof ApiError && error.code === 'batch_resource_keys_missing',
    '缺少 resource_keys 的任务载荷必须显式报错'
  )
  assert.deepEqual(peekResourceKeys({ provider_id: 'cf-1' }), [], '重试路径遇缺字段应退化为空集合')

  // 老作业没有 resource_keys：降级为 payload 同名字段判定（更窄但确定），
  // 一律当作不互斥会让同一站点被重复写入；反查与创建必须走同一份降级口径
  const legacyActive = await lockJobs.create(
    DNS_BATCH_CREATE_JOB,
    { provider_type: 'dnspod', provider_id: 'dns-4', zone: 'legacy.example.com' },
    [{ name: 'legacy-active' }],
    { start: false }
  )
  assert.equal(
    await lockKind.active({ provider_type: 'dnspod', provider_id: 'dns-4', zone: 'legacy.example.com' }, [
      dnsZoneKey('dnspod', 'dns-4', 'legacy.example.com'),
    ]),
    legacyActive.id,
    '缺资源键的历史作业必须按站点字段降级命中反查'
  )
  assert.equal(
    await lockKind.active({ provider_type: 'dnspod', provider_id: 'dns-4', zone: 'other.example.com' }, [
      dnsZoneKey('dnspod', 'dns-4', 'other.example.com'),
    ]),
    null,
    '降级判定同样不得跨站点误报'
  )
  await assert.rejects(
    () =>
      lockJobs.createExclusive(
        DNS_BATCH_CREATE_JOB,
        {
          provider_type: 'dnspod',
          provider_id: 'dns-4',
          zone: 'legacy.example.com',
          resource_keys: [dnsZoneKey('dnspod', 'dns-4', 'legacy.example.com')],
        },
        [],
        lockKind.lock({
          provider_type: 'dnspod',
          provider_id: 'dns-4',
          zone: 'legacy.example.com',
          resource_keys: [dnsZoneKey('dnspod', 'dns-4', 'legacy.example.com')],
        }),
        { start: false }
      ),
    (error: unknown) => error instanceof ApiError && error.code === 'batch_job_running',
    '缺资源键的历史作业在创建路径同样必须判定为互斥'
  )

  // 早于资源键字段的历史 payload 必须仍可重试：退化到 scope 判定，而不是让任务卡死在重试接口。
  // 注册真实 runner 并等执行到终态：缺键只影响互斥范围，不得影响执行链路
  lockJobs.registerRunner(DNS_BATCH_CREATE_JOB, async (job) => {
    await lockJobs.patch(job.id, { status: 'completed', message: 'legacy payload executed' })
  })
  const legacyJob = await lockJobs.createTerminalExclusive(
    DNS_BATCH_CREATE_JOB,
    { provider_type: 'dnspod', provider_id: 'dns-1', zone: 'example.com' },
    [{ name: 'legacy', status: 'failed' }],
    undefined,
    { status: 'failed', success: 0, failed: 1, skipped: 0, message: 'legacy payload' }
  )
  assert.equal(await lockKind.retryFailed(legacyJob.id), legacyJob.id, '缺资源键的历史任务必须仍可重试')
  assert.equal((await lockJobs.get(legacyJob.id))?.items[0]?.status, 'pending', '重试必须把失败条目改回待执行')
  await lockJobs.drain()
  assert.equal((await lockJobs.get(legacyJob.id))?.status, 'completed', '缺资源键的历史任务必须能真正执行到终态')

  console.log('platform-concurrency-probe=ok')
} finally {
  await fs.rm(dataDir, { recursive: true, force: true })
}
