import { describe, expect, it } from 'vitest'
import { BatchJobKind, type BatchJobViewBase } from './batch-job.js'
import { JobService } from './job.service.js'
import { DNS_BATCH_CREATE_JOB, SAAS_BATCH_DELETE_JOB, dnsZoneKey, readResourceKeys } from './job-registry.js'

/**
 * 互斥只有一个口径：资源键交集。
 * 面板反查（BatchJobKind.active）与创建（JobService.createExclusive → assertNoActiveConflict）
 * 共用 job-registry.jobConflictsWith，跨工作流写同一底层资源时两处结论必须一致——
 * 否则用户会看到「没有正在运行的作业」却创建失败。
 */

/** 两个族共享同一互斥范围（ZONE_WRITE_JOB_TYPES 的简化版），payload 字段名各不相同 */
const LOCK_TYPES = [DNS_BATCH_CREATE_JOB, SAAS_BATCH_DELETE_JOB] as const

function dnsKind(jobs: JobService) {
  return new BatchJobKind<BatchJobViewBase>(jobs, {
    types: [DNS_BATCH_CREATE_JOB],
    lockTypes: LOCK_TYPES,
    scopeKeys: ['provider_id', 'zone'],
    resourceKeys: readResourceKeys,
    present: (_job, base) => base,
  })
}

function saasKind(jobs: JobService) {
  return new BatchJobKind<BatchJobViewBase>(jobs, {
    types: [SAAS_BATCH_DELETE_JOB],
    lockTypes: LOCK_TYPES,
    scopeKeys: ['provider_id', 'zone_name'],
    resourceKeys: readResourceKeys,
    present: (_job, base) => base,
  })
}

describe('互斥判定单一口径（资源键交集）', () => {
  it('资源键相交：面板反查与创建拒绝必须同时成立', async () => {
    const jobs = new JobService()
    const zoneKey = dnsZoneKey('cloudflare', 'cf-1', 'example.com')

    // SaaS 批量任务占用了 DNS 批量要写的同一个 Cloudflare 站点（payload 字段名不同，只有资源键相同）
    const saasJob = await jobs.createExclusive(
      SAAS_BATCH_DELETE_JOB,
      { provider_id: 'cf-1', zone_name: 'example.com', resource_keys: [zoneKey] },
      [{ hostname: 'a.example.com' }],
      saasKind(jobs).lock({ provider_id: 'cf-1', zone_name: 'example.com', resource_keys: [zoneKey] }),
      { start: false }
    )

    const dnsPayload = {
      provider_type: 'cloudflare',
      provider_id: 'cf-1',
      zone: 'example.com',
      resource_keys: [zoneKey],
    }
    // 查询侧：跨工作流命中也必须照实返回，否则面板会显示「没有作业在运行」
    expect((await dnsKind(jobs).active({ provider_id: 'cf-1', zone: 'example.com' }, [zoneKey]))?.id).toBe(saasJob.id)
    // 创建侧：与反查出自同一份判定，必然同样判定为互斥
    await expect(
      jobs.createExclusive(DNS_BATCH_CREATE_JOB, dnsPayload, [{ name: '@' }], dnsKind(jobs).lock(dnsPayload), {
        start: false,
      })
    ).rejects.toMatchObject({ code: 'batch_job_running' })
  })

  it('资源键不相交：面板反查为空且创建放行', async () => {
    const jobs = new JobService()
    const busyZone = dnsZoneKey('cloudflare', 'cf-1', 'busy.example.com')
    const freeZone = dnsZoneKey('cloudflare', 'cf-1', 'free.example.com')
    await jobs.createExclusive(
      SAAS_BATCH_DELETE_JOB,
      { provider_id: 'cf-1', zone_name: 'busy.example.com', resource_keys: [busyZone] },
      [{ hostname: 'a.busy.example.com' }],
      saasKind(jobs).lock({ provider_id: 'cf-1', zone_name: 'busy.example.com', resource_keys: [busyZone] }),
      { start: false }
    )

    expect(await dnsKind(jobs).active({ provider_id: 'cf-1', zone: 'free.example.com' }, [freeZone])).toBeNull()
    const payload = {
      provider_type: 'cloudflare',
      provider_id: 'cf-1',
      zone: 'free.example.com',
      resource_keys: [freeZone],
    }
    const created = await jobs.createExclusive(
      DNS_BATCH_CREATE_JOB,
      payload,
      [{ name: 'www' }],
      dnsKind(jobs).lock(payload),
      {
        start: false,
      }
    )
    expect(created.id).not.toBe('')
  })

  it('老作业没有 resource_keys：按站点字段降级判定，两处仍一致', async () => {
    const jobs = new JobService()
    // 早于资源键机制的作业：payload 里没有 resource_keys，只有站点字段
    const legacy = await jobs.createExclusive(
      DNS_BATCH_CREATE_JOB,
      { provider_type: 'dnspod', provider_id: 'dns-1', zone: 'legacy.example.com' },
      [{ name: 'legacy' }],
      undefined,
      { start: false }
    )

    const sameZone = dnsZoneKey('dnspod', 'dns-1', 'legacy.example.com')
    const otherZone = dnsZoneKey('dnspod', 'dns-1', 'other.example.com')
    expect((await dnsKind(jobs).active({ provider_id: 'dns-1', zone: 'legacy.example.com' }, [sameZone]))?.id).toBe(
      legacy.id
    )
    expect(await dnsKind(jobs).active({ provider_id: 'dns-1', zone: 'other.example.com' }, [otherZone])).toBeNull()

    const blocked = {
      provider_type: 'dnspod',
      provider_id: 'dns-1',
      zone: 'legacy.example.com',
      resource_keys: [sameZone],
    }
    await expect(
      jobs.createExclusive(DNS_BATCH_CREATE_JOB, blocked, [{ name: '@' }], dnsKind(jobs).lock(blocked), {
        start: false,
      })
    ).rejects.toMatchObject({ code: 'batch_job_running' })

    const allowed = {
      provider_type: 'dnspod',
      provider_id: 'dns-1',
      zone: 'other.example.com',
      resource_keys: [otherZone],
    }
    await expect(
      jobs.createExclusive(DNS_BATCH_CREATE_JOB, allowed, [{ name: 'ok' }], dnsKind(jobs).lock(allowed), {
        start: false,
      })
    ).resolves.toMatchObject({ status: 'pending' })
  })
})
