#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonStore } from '../src/platform/storage/json-store.js'
import { JobService } from '../src/platform/jobs/job.service.js'
import { SaaSBatchJobWorkflow } from '../src/workflows/saas-dns-sync/saas-batch.workflow.js'

type DeleteOptions = {
  primaryDeleted?: boolean
  cleanup?: { hostname_fqdn: string; records: Array<Record<string, unknown>> }
  onCleanupPrepared?: (cleanup: { hostname_fqdn: string; records: Array<Record<string, unknown>> }) => Promise<void>
  onPrimaryDeleted?: () => Promise<void>
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-workflow-recovery-'))
try {
  const jobs = new JobService(new JsonStore('jobs/jobs.json', { items: [] }, dataDir))
  let primaryDeletes = 0
  let cleanupCollections = 0
  let cleanupAttempts = 0
  let cleanupRecipeDurableBeforePrimary = false
  let primaryDeleteDurableBeforeCleanup = false
  const durableItem = async () => {
    const state = JSON.parse(await fs.readFile(path.join(dataDir, 'jobs/jobs.json'), 'utf8')) as {
      items?: Array<{ items?: Array<Record<string, unknown>> }>
    }
    return state.items?.[0]?.items?.[0] ?? {}
  }
  const workflow = {
    async deleteHostname(
      _providerId: string,
      _zoneName: string,
      hostname: string,
      _autoCleanup: boolean,
      options: DeleteOptions = {}
    ) {
      let cleanup = options.cleanup
      if (!cleanup) {
        cleanupCollections++
        cleanup = {
          hostname_fqdn: hostname,
          records: [{ type: 'CNAME', name: hostname, value: 'origin.example.com' }],
        }
        await options.onCleanupPrepared?.(cleanup)
      }
      if (!options.primaryDeleted) {
        cleanupRecipeDurableBeforePrimary = Boolean((await durableItem()).cleanup_recipe)
        primaryDeletes++
        await options.onPrimaryDeleted?.()
      }
      primaryDeleteDurableBeforeCleanup = (await durableItem()).primary_deleted === true
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
  const hostnames = {
    async resolveZoneRef() {
      return { cloudflareProviderId: 'cf-owner', zoneId: 'zone-1' }
    },
  }
  const batch = new SaaSBatchJobWorkflow(jobs, workflow as never, hostnames as never)
  const created = await batch.createDelete({
    providerId: 'saas-owner',
    zoneName: 'example.com',
    hostnames: ['www.example.com'],
    autoCleanup: true,
  })
  await jobs.drain()
  const failed = await batch.find(created.id)
  assert.equal(failed?.status, 'failed')
  assert.equal(cleanupRecipeDurableBeforePrimary, true, 'cleanup recipe was not durable before primary delete')
  assert.equal(primaryDeleteDurableBeforeCleanup, true, 'primary delete stage was not durable before DNS cleanup')
  assert.equal(failed?.items[0]?.primary_deleted, true, 'completed primary delete stage was not persisted')
  assert.ok(failed?.items[0]?.cleanup_recipe, 'cleanup recipe was not persisted before the primary delete')

  await batch.retryFailed(created.id)
  await jobs.drain()
  const retried = await batch.find(created.id)
  assert.equal(retried?.status, 'completed')
  assert.equal(retried?.items[0]?.dns_cleanup_status, 'completed')
  assert.equal(primaryDeletes, 1, 'retry replayed an already-completed SaaS hostname delete')
  assert.equal(cleanupCollections, 1, 'retry recollected a cleanup recipe after the hostname was deleted')
  assert.equal(cleanupAttempts, 2)
  console.log('workflow-recovery-probe=ok')
} finally {
  await fs.rm(dataDir, { recursive: true, force: true })
}
