import { describe, expect, it } from 'vitest'
import { JobService } from './job.service.js'
import { SAAS_BATCH_UPDATE_JOB } from './job-registry.js'

/**
 * 迁移自 scripts/isolated-provider-retry-probe.ts 的任务快照部分（P1：内存实现，无 IO）。
 * 已完成任务剥离执行期快照以控体积；失败任务保留快照供重试恢复。
 */

const bigSnapshot = { type: 'CNAME', name: 'a.example.com', value: 'x'.repeat(4096), purpose: 'origin_cname' }

describe('任务快照体积守卫', () => {
  it('已完成任务剥离执行期快照，保留展示字段', async () => {
    const jobs = new JobService()
    const created = await jobs.create(
      SAAS_BATCH_UPDATE_JOB,
      {},
      [
        {
          hostname: 'a.example.com',
          status: 'pending',
          dns_before_records: [bigSnapshot],
          cleanup_recipe: { hostname_fqdn: 'a.example.com', records: [bigSnapshot] },
        },
      ],
      { start: false }
    )
    await jobs.patch(created.id, { status: 'completed', finished_at: Date.now() })

    const completedItem = (await jobs.get(created.id))?.items[0] ?? {}
    expect('dns_before_records' in completedItem).toBe(false)
    expect('cleanup_recipe' in completedItem).toBe(false)
    expect(completedItem.hostname).toBe('a.example.com')
  })

  it('失败任务保留快照（重试才能恢复更新前状态）', async () => {
    const jobs = new JobService()
    const failed = await jobs.create(SAAS_BATCH_UPDATE_JOB, {}, [{ hostname: 'b.example.com', status: 'pending' }], {
      start: false,
    })
    await jobs.patchItem(failed.id, () => true, { status: 'failed', dns_before_records: [bigSnapshot] })
    await jobs.patch(failed.id, { status: 'failed', finished_at: Date.now() })

    const failedItem = (await jobs.get(failed.id))?.items[0] ?? {}
    // 快照内容必须完整保留：空数组或剥离后的字段都过不了重试恢复
    expect(failedItem.dns_before_records).toEqual([bigSnapshot])
  })
})
