import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../http/api-error.js'
import { JsonStore } from '../store/json-store.js'
import { BatchJobKind, runBatchItems } from './batch-job.js'
import { JobService } from './job.service.js'
import { summarizeJobItems } from './job.types.js'
import {
  DNS_BATCH_CREATE_JOB,
  DNS_BATCH_UPDATE_JOB,
  SAAS_BATCH_DELETE_JOB,
  dnsZoneKey,
  peekResourceKeys,
  readResourceKeys,
} from './job-registry.js'

/**
 * 迁移自 scripts/isolated-platform-concurrency-probe.ts（进程内并发语义）。
 * 互斥「资源键交集」判定的主路径已由 job-mutex.test.ts 钉住，这里只补齐该探针中尚未被覆盖的差异部分：
 * 跨实例写队列、任务执行去重与关闭等待、反查/详情归属的完整路径、历史 payload 重试兼容。
 * provider-cache 的单飞与失效栅栏断言落在 core/cache/provider-cache.test.ts（同主题就近安放）。
 */

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** 断言同步抛出的是指定 code 的 ApiError（等价于原探针的 assert.throws 谓词形式） */
function expectApiErrorSync(run: () => unknown, code: string): void {
  let thrown: unknown = null
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ApiError)
  expect((thrown as ApiError).code).toBe(code)
}

describe('JsonStore：同一文件的跨实例写队列', () => {
  it('两个实例并发写同一路径：写队列串行化，全部事务都落盘', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-concurrency-'))
    // 同一绝对路径的两个实例共享一份进程级写队列（原探针：Separate JsonStore instances share one process queue）
    const left = new JsonStore<{ value: number }>('counter.json', { value: 0 }, dataDir)
    const right = new JsonStore<{ value: number }>('counter.json', { value: 0 }, dataDir)
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? left : right).transaction((current) => ({ next: { value: current.value + 1 } }))
      )
    )
    expect((await left.readFresh()).value).toBe(20)

    // readFresh 必须观察磁盘真值，而不是实例内的陈旧缓存
    await fs.writeFile(path.join(dataDir, 'counter.json'), '{"value":21}\n')
    expect((await right.readFresh()).value).toBe(21)
  })

  it('越界路径在构造时即被拒绝', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-concurrency-'))
    expectApiErrorSync(() => new JsonStore('../escaped.json', {}, dataDir), 'server_error')
    expect(() => new JsonStore('../escaped.json', {}, dataDir)).toThrow(/data root/)
    expect(() => new JsonStore(path.join(dataDir, 'absolute.json'), {}, dataDir)).toThrow(/relative to data root/)
  })
})

describe('JobService：执行去重、关闭等待与终态不可回改', () => {
  it('inflight 去重：重复 get 只启动一次 runner，drain 后进入终态', async () => {
    const jobs = new JobService()
    let runnerCalls = 0
    const runnerStarted = deferred<void>()
    const release = deferred<void>()
    jobs.registerRunner(DNS_BATCH_CREATE_JOB, async () => {
      runnerCalls++
      runnerStarted.resolve()
      await release.promise
    })
    const once = await jobs.create(DNS_BATCH_CREATE_JOB, {}, [{ key: 'x' }], { start: false })
    // get() 会触发后台启动：重复调用必须被 inflight 去重
    void jobs.get(once.id)
    void jobs.get(once.id)
    await runnerStarted.promise
    expect(runnerCalls).toBe(1)
    release.resolve()
    await jobs.drain()
    expect((await jobs.get(once.id))?.status).toBe('completed')
  })

  it('close 必须等运行中的任务落定终态后才返回', async () => {
    const jobs = new JobService()
    const runnerStarted = deferred<void>()
    const releaseRunner = deferred<void>()
    jobs.registerRunner(SAAS_BATCH_DELETE_JOB, async () => {
      runnerStarted.resolve()
      await releaseRunner.promise
    })
    const closing = await jobs.create(SAAS_BATCH_DELETE_JOB, {}, [{ key: 'x' }])
    await runnerStarted.promise
    const closeResult = jobs.close().then(() => 'closed' as const)
    const beforeRelease = await Promise.race([
      closeResult,
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 30)),
    ])
    releaseRunner.resolve()
    await closeResult
    expect(beforeRelease).toBe('waiting')
    // close 返回前必须已在内存里落定终态，而不是留下 running 残留
    expect((await jobs.get(closing.id))?.status).toBe('completed')
  })

  it('条目停在执行中属于待确认：不重放副作用，条目置失败并说明原因', async () => {
    const jobs = new JobService()
    const effects: string[] = []
    jobs.registerRunner(DNS_BATCH_UPDATE_JOB, async (job) => {
      await runBatchItems(jobs, job, {
        itemKey: (item) => String(item.key),
        runningMessage: 'running',
        progressMessage: 'running',
        execute: async (_item, key) => {
          effects.push(key)
          return { status: 'success' }
        },
      })
    })
    const uncertain = await jobs.create(
      DNS_BATCH_UPDATE_JOB,
      {},
      [
        { key: 'uncertain', status: 'running' },
        { key: 'pending', status: 'pending' },
      ],
      { start: false }
    )
    await jobs.get(uncertain.id)
    await jobs.drain()
    const settled = await jobs.get(uncertain.id)
    expect(effects).toEqual(['pending'])
    expect(settled?.status).toBe('failed')
    expect(settled?.items[0]?.status).toBe('failed')
    expect(String(settled?.items[0]?.message)).toMatch(/待确认/)
  })

  it('终态任务不可被 patch / patchItem 回改', async () => {
    const jobs = new JobService()
    const terminal = await jobs.createTerminalExclusive(
      DNS_BATCH_CREATE_JOB,
      {},
      [{ key: 'x', status: 'success' }],
      undefined,
      {
        status: 'completed',
        success: 1,
        failed: 0,
        skipped: 0,
        message: 'done',
      }
    )
    expect(await jobs.patch(terminal.id, { status: 'failed' })).toBeNull()
    await jobs.patchItem(terminal.id, () => true, { status: 'failed' }, { status: 'running' })
    await jobs.drain()
    expect((await jobs.get(terminal.id))?.status).toBe('completed')
  })

  it('summarizeJobItems 按条目状态统计', () => {
    expect(summarizeJobItems([{ status: 'failed' }, { status: 'success' }])).toEqual({
      done: 2,
      success: 1,
      failed: 1,
      skipped: 0,
    })
  })
})

/** 两族共享同一互斥范围（ZONE_WRITE_JOB_TYPES 的简化版），payload 字段名各不相同 */
const LOCK_TYPES = [DNS_BATCH_CREATE_JOB, SAAS_BATCH_DELETE_JOB] as const

function dnsKind(jobs: JobService) {
  return new BatchJobKind<string>(jobs, {
    types: [DNS_BATCH_CREATE_JOB],
    lockTypes: LOCK_TYPES,
    scopeKeys: ['provider_id', 'zone'],
    resourceKeys: readResourceKeys,
    present: (job) => job.id,
  })
}

function saasKind(jobs: JobService) {
  return new BatchJobKind<string>(jobs, {
    types: [SAAS_BATCH_DELETE_JOB],
    lockTypes: LOCK_TYPES,
    scopeKeys: ['provider_id', 'zone_name'],
    resourceKeys: readResourceKeys,
    present: (job) => job.id,
  })
}

describe('BatchJobKind：面板反查与详情归属', () => {
  it('本族面板反查命中本族任务；详情端点按 providerId 归属校验', async () => {
    const jobs = new JobService()
    const zoneKey = dnsZoneKey('cloudflare', 'cf-1', 'example.com')
    const saasJob = await jobs.create(
      SAAS_BATCH_DELETE_JOB,
      { provider_id: 'cf-1', zone_name: 'example.com', resource_keys: [zoneKey] },
      [{ hostname: 'a.example.com' }],
      { start: false }
    )

    // SaaS 面板按 payload 字段（provider_id / zone_name）反查，必须命中本族活跃任务
    const activeId = await saasKind(jobs).active({ provider_id: 'cf-1', zone_name: 'example.com' }, [zoneKey])
    expect(activeId).toBe(saasJob.id)
    // 反查返回的任务 id 必须能被同 providerId 的详情端点取到
    expect(await saasKind(jobs).find(String(activeId), { provider_id: 'cf-1' })).toBe(saasJob.id)
    // 别族服务商的详情端点仍必须取不到该任务
    expect(await saasKind(jobs).find(String(activeId), { provider_id: 'cf-2' })).toBeNull()
  })

  it('不同服务商的同名站点不得误报为活跃冲突', async () => {
    const jobs = new JobService()
    const job = await jobs.create(
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
    expect(
      await dnsKind(jobs).active({ provider_type: 'dnspod', provider_id: 'dns-2', zone: 'locks.example.com' }, [
        dnsZoneKey('dnspod', 'dns-2', 'locks.example.com'),
      ])
    ).toBe(job.id)
    expect(await dnsKind(jobs).find(job.id, { provider_id: 'dns-2' })).toBe(job.id)
    expect(
      await dnsKind(jobs).active({ provider_type: 'dnspod', provider_id: 'dns-3', zone: 'locks.example.com' }, [
        dnsZoneKey('dnspod', 'dns-3', 'locks.example.com'),
      ])
    ).toBeNull()
  })

  it('资源键缺失属于装配错误：创建路径显式失败，查询路径退化为空集合', () => {
    expectApiErrorSync(() => readResourceKeys({ provider_id: 'cf-1' }), 'batch_resource_keys_missing')
    expect(peekResourceKeys({ provider_id: 'cf-1' })).toEqual([])
  })

  it('缺资源键的历史 payload 仍可重试并执行到终态', async () => {
    const jobs = new JobService()
    const kind = dnsKind(jobs)
    jobs.registerRunner(DNS_BATCH_CREATE_JOB, async (job) => {
      await jobs.patch(job.id, { status: 'completed', message: 'legacy payload executed' })
    })
    // 早于资源键字段的历史 payload：退化到 scope 判定，而不是让任务卡死在重试接口
    const legacyJob = await jobs.createTerminalExclusive(
      DNS_BATCH_CREATE_JOB,
      { provider_type: 'dnspod', provider_id: 'dns-1', zone: 'example.com' },
      [{ name: 'legacy', status: 'failed' }],
      undefined,
      { status: 'failed', success: 0, failed: 1, skipped: 0, message: 'legacy payload' }
    )
    expect(await kind.retryFailed(legacyJob.id)).toBe(legacyJob.id)
    expect((await jobs.get(legacyJob.id))?.items[0]?.status).toBe('pending')
    await jobs.drain()
    expect((await jobs.get(legacyJob.id))?.status).toBe('completed')
  })
})
