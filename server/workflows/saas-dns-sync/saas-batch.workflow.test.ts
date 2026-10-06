import { describe, expect, it } from 'vitest'
import { JobService } from '../../core/jobs/job.service.js'
import { SaaSBatchWorkflow } from './saas-batch.workflow.js'

type DeleteOptions = {
  completed?: readonly string[]
  cleanup?: { hostname_fqdn: string; records: Array<Record<string, unknown>> }
  onStage?: (stage: string, patch: Record<string, unknown>) => Promise<void>
}

/**
 * 批量删除的阶段顺序：清理配方必须先于不可逆的远端删除落盘，远端删除标记必须先于 DNS 清理落盘。
 * 顺序错了的后果是重试时无法重建清理目标（主机名已删、配方丢失），只能留手工收拾。
 */
describe('SaaSBatchWorkflow 删除阶段顺序', () => {
  it('阶段标记先于不可逆操作落盘，且重试只补做未完成部分', async () => {
    let primaryDeletes = 0
    let cleanupCollections = 0
    let cleanupAttempts = 0
    let cleanupRecipeRecordedBeforePrimary = false
    let primaryDeleteRecordedBeforeCleanup = false

    const jobs = new JobService()
    /** 执行期间从内存读当前任务条目：阶段标记必须先于不可逆外部操作写入 */
    const activeItem = async () => (await jobs.listActive())[0]?.items[0] ?? {}

    const workflow = {
      // 方法名必须与 SaaSBatchWorkflow 实际调用的一致：批量路径走 deleteHostnameInBatch
      // （单条写入的 deleteHostname 会顺带失效站点列表缓存，批量路径不能逐条清）
      async deleteHostnameInBatch(
        _providerId: string,
        _zoneName: string,
        hostname: string,
        _autoCleanup: boolean,
        options: DeleteOptions = {}
      ) {
        const completed = new Set(options.completed ?? [])
        if (!completed.has('cleanup-prepared')) {
          cleanupCollections++
          const cleanup = {
            hostname_fqdn: hostname,
            records: [{ type: 'CNAME', name: hostname, value: 'origin.example.com' }],
          }
          await options.onStage?.('cleanup-prepared', { cleanup_recipe: cleanup })
        }
        if (!completed.has('primary-deleted')) {
          cleanupRecipeRecordedBeforePrimary = Boolean((await activeItem()).cleanup_recipe)
          primaryDeletes++
          await options.onStage?.('primary-deleted', { primary_deleted: true })
        }
        primaryDeleteRecordedBeforeCleanup = (await activeItem()).primary_deleted === true
        cleanupAttempts++
        return {
          hostname,
          side_effects: {
            dns: {
              cleanup:
                cleanupAttempts === 1
                  ? { status: 'failed', message: 'temporary cleanup failure', details: [] }
                  : { status: 'completed', message: 'cleanup completed', details: [] },
            },
          },
        }
      },
    }
    const workflowWithKeys = { ...(workflow as object), resourceKeys: async () => [] }
    const hostnames = {
      async resolveZoneRef() {
        return { cloudflareProviderId: 'cf-owner', zoneId: 'zone-1' }
      },
    }
    const batch = new SaaSBatchWorkflow(jobs, workflowWithKeys as never, hostnames as never)
    const created = await batch.createDelete({
      providerId: 'saas-owner',
      zoneName: 'example.com',
      hostnames: ['www.example.com'],
      autoCleanup: true,
    })
    await jobs.drain()
    const failed = await batch.require(created.id, 'saas-owner')
    expect(failed?.status).toBe('failed')
    expect(cleanupRecipeRecordedBeforePrimary).toBe(true)
    expect(primaryDeleteRecordedBeforeCleanup).toBe(true)
    expect(failed?.items[0]?.primary_deleted).toBe(true)
    // cleanup_recipe 属于内部执行字段：保留在原始记录里，但不通过 API 视图暴露
    expect((await jobs.get(created.id))?.items[0]?.cleanup_recipe).toBeTruthy()
    expect('cleanup_recipe' in (failed?.items[0] ?? {})).toBe(false)

    await batch.retryFailed(created.id, 'saas-owner')
    await jobs.drain()
    const retried = await batch.require(created.id, 'saas-owner')
    expect(retried?.status).toBe('completed')
    expect(retried?.items[0]?.dns_cleanup_status).toBe('completed')
    expect(primaryDeletes).toBe(1)
    expect(cleanupCollections).toBe(1)
    expect(cleanupAttempts).toBe(2)
  })
})
