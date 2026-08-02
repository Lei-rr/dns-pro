#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SaaSDnsSyncWorkflow } from '../server/src/workflows/saas-dns-sync/saas-dns-sync.workflow.js'

const calls: string[] = []
const sync = {
  async syncSaaSHostname(_providerId: string, _zoneName: string, hostname: string) {
    calls.push(`sync:${hostname}`)
    return { status: 'completed', records: [{ type: 'CNAME', status: 'updated' }] }
  },
  normalizeSyncSideEffect(result: Record<string, unknown>, message: string) {
    return { status: result.status, message, details: [result] }
  },
}
const workflow = new SaaSDnsSyncWorkflow({} as never, {} as never, sync as never)
const repair = (
  workflow as unknown as {
    repairHostnameDns(providerId: string, zoneName: string, hostname: string): Promise<Record<string, unknown>>
  }
).repairHostnameDns
assert.equal(typeof repair, 'function', 'SaaS DNS repair workflow is missing')
const result = await repair.call(workflow, 'saas', 'example.com', 'www.example.com')
assert.deepEqual(calls, ['sync:www.example.com'], 'repair must delegate to the existing upsert exactly once')
assert.equal(result.hostname, 'www.example.com')
assert.equal(
  ((result.side_effects as Record<string, unknown>).dns as Record<string, unknown> as { sync: { status: string } }).sync
    .status,
  'completed'
)

const root = new URL('../', import.meta.url)
const files = await Promise.all(
  [
    'web/src/features/edge-one/ui/AccelerationDomainsTable.vue',
    'web/src/features/edge-one/ui/AccelerationDomainsPanel.vue',
    'web/src/features/saas/ui/SaasHostsTable.vue',
    'web/src/features/saas/ui/SaasHostsPanel.vue',
  ].map(async (file) => [file, await readFile(new URL(file, root), 'utf8')] as const)
)
const source = new Map(files)
assert.match(source.get('web/src/features/edge-one/ui/AccelerationDomainsTable.vue') || '', />修复域名解析</)
assert.doesNotMatch(source.get('web/src/features/edge-one/ui/AccelerationDomainsTable.vue') || '', />同步 CNAME</)
assert.match(source.get('web/src/features/edge-one/ui/AccelerationDomainsPanel.vue') || '', /@repair-dns=/)
assert.match(source.get('web/src/features/saas/ui/SaasHostsTable.vue') || '', />修复域名解析</)
assert.match(source.get('web/src/features/saas/ui/SaasHostsPanel.vue') || '', /@repair-dns=/)

console.log('saas-dns-repair-probe=ok workflow=real-sync ui=unified')
