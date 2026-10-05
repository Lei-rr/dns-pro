#!/usr/bin/env node
import assert from 'node:assert/strict'
import { JobService } from '../server/core/jobs/job.service.js'
import { SaaSBatchWorkflow } from '../server/workflows/saas-dns-sync/saas-batch.workflow.js'

type DeleteOptions = {
  completed?: readonly string[]
  cleanup?: { hostname_fqdn: string; records: Array<Record<string, unknown>> }
  onStage?: (stage: string, patch: Record<string, unknown>) => Promise<void>
}

let primaryDeletes = 0
let cleanupCollections = 0
let cleanupAttempts = 0
let cleanupRecipeRecordedBeforePrimary = false
let primaryDeleteRecordedBeforeCleanup = false

const jobs = new JobService()
/** 执行期间从内存读当前任务条目：阶段标记必须先于不可逆外部操作写入 */
const activeItem = async () => (await jobs.listActive())[0]?.items[0] ?? {}

const workflow = {
  async deleteHostname(
    _providerId: string,
    _zoneName: string,
    hostname: string,
    _autoCleanup: boolean,
    options: DeleteOptions = {}
  ) {
    const completed = new Set(options.completed ?? [])
    let cleanup = options.cleanup
    if (!completed.has('cleanup-prepared')) {
      cleanupCollections++
      cleanup = {
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
assert.equal(failed?.status, 'failed')
assert.equal(cleanupRecipeRecordedBeforePrimary, true, 'cleanup recipe was not recorded before primary delete')
assert.equal(primaryDeleteRecordedBeforeCleanup, true, 'primary delete stage was not recorded before DNS cleanup')
assert.equal(failed?.items[0]?.primary_deleted, true, 'completed primary delete stage was not kept')
// cleanup_recipe 属于内部执行字段：保留在原始记录里，但不通过 API 视图暴露
assert.ok(
  (await jobs.get(created.id))?.items[0]?.cleanup_recipe,
  'cleanup recipe was not recorded before the primary delete'
)
assert.equal('cleanup_recipe' in (failed?.items[0] ?? {}), false, '内部清理配方不应出现在任务视图')

await batch.retryFailed(created.id)
await jobs.drain()
const retried = await batch.require(created.id, 'saas-owner')
assert.equal(retried?.status, 'completed')
assert.equal(retried?.items[0]?.dns_cleanup_status, 'completed')
assert.equal(primaryDeletes, 1, 'retry replayed an already-completed SaaS hostname delete')
assert.equal(cleanupCollections, 1, 'retry recollected a cleanup recipe after the hostname was deleted')
assert.equal(cleanupAttempts, 2)
console.log('workflow-recovery-probe=ok')
