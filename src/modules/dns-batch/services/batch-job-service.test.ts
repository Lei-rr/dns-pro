import assert from 'node:assert/strict'
import test from 'node:test'
import type { JobRecord } from '../../../platform/job/types.js'
import type { JobService } from '../../../platform/job/job-service.js'
import { DNS_BATCH_CREATE_JOB, DnsBatchJobService } from './batch-job-service.js'

class FakeJobs {
  runner?: (job: JobRecord) => Promise<void>
  created?: JobRecord

  registerRunner(type: string, runner: (job: JobRecord) => Promise<void>) {
    if (type === DNS_BATCH_CREATE_JOB) this.runner = runner
  }

  async listActive() {
    return []
  }

  async create(type: string, payload: Record<string, unknown>, items: Array<Record<string, unknown>>) {
    this.created = {
      id: 'job-create',
      type,
      status: 'pending',
      total: items.length,
      done: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      payload,
      items,
      created_at: 1,
      updated_at: 1,
    }
    return this.created
  }
}

test('creates durable dns.batch_create job with one item per unique host record', async () => {
  const jobs = new FakeJobs()
  const service = new DnsBatchJobService(jobs as unknown as JobService, {
    dnspod: { create: async () => ({}), update: async () => ({}), delete: async () => ({}) },
  })

  const job = await service.createCreate({
    providerType: 'dnspod',
    providerId: 'p1',
    zone: 'example.com',
    records: [
      { name: 'www', type: 'A', value: '1.2.3.4', ttl: 600 },
      { name: 'ggg', type: 'A', value: '1.2.3.4', ttl: 600 },
      { name: 'www', type: 'A', value: '1.2.3.4', ttl: 600 },
    ],
  })

  assert.equal(job.type, DNS_BATCH_CREATE_JOB)
  assert.deepEqual(job.items.map((item) => item.name), ['www', 'ggg'])
})

test('background create runner maps Cloudflare host to FQDN and finishes the job', async () => {
  const calls: Array<Record<string, unknown>> = []
  const items = [{ item_key: 'www\u0000A\u0000', name: 'www', type: 'A', value: '1.2.3.4', ttl: 1, status: 'pending' }]
  const job: JobRecord = {
    id: 'job-run',
    type: DNS_BATCH_CREATE_JOB,
    status: 'running',
    total: 1,
    done: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    payload: { provider_type: 'cloudflare', provider_id: 'p1', zone: 'zone-id', zone_name: 'example.com' },
    items,
    created_at: 1,
    updated_at: 1,
  }
  const jobs = new FakeJobs()
  type RunnableJobs = FakeJobs & {
    patchItem: (
      id: string,
      match: (item: Record<string, unknown>) => boolean,
      patch: Record<string, unknown>,
    ) => Promise<void>
    get: (id: string) => Promise<JobRecord>
    patch: (id: string, patch: Partial<JobRecord>) => Promise<JobRecord>
  }
  const runnableJobs = jobs as RunnableJobs
  runnableJobs.patchItem = async (_id, match, patch) => {
    for (const item of items) if (match(item)) Object.assign(item, patch)
  }
  runnableJobs.get = async () => job
  runnableJobs.patch = async (_id, patch) => Object.assign(job, patch)
  new DnsBatchJobService(jobs as unknown as JobService, {
    cloudflare: {
      create: async (_provider: string, zone: string, body: Record<string, unknown>) => {
        calls.push({ zone, ...body })
        return { id: 'record-1' }
      },
      update: async () => ({}),
      delete: async () => ({}),
    },
  })

  assert.ok(jobs.runner)
  await jobs.runner!(job)
  assert.deepEqual(calls, [{ zone: 'zone-id', type: 'A', name: 'www.example.com', content: '1.2.3.4', ttl: 1 }])
  assert.equal(items[0].status, 'success')
  assert.equal(job.status, 'completed')
})
