#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { useJobProgress } from '../web/src/shared/job/model/use-job-progress.js'

const root = new URL('../', import.meta.url)
const source = async (path: string) => readFile(new URL(path, root), 'utf8')

const progress = useJobProgress()
const resumeResult = await progress.resumeActive(
  async () => {
    throw new Error('active job unavailable')
  },
  { fetchJob: async () => ({ id: 'unused', status: 'completed' }), autoClearMs: 0 }
)
assert.equal(resumeResult, null)
assert.equal(progress.running.value, false)
assert.equal(
  progress.resumeError.value,
  'active job unavailable',
  'resume failure is indistinguishable from no active job'
)

const records = await source('web/src/features/dns/ui/RecordsPanel.vue')
const zones = await source('web/src/features/dns/ui/ZonesPanel.vue')
const tunnels = await source('web/src/features/tunnels/ui/TunnelsPanel.vue')
const tunnelDetail = await source('web/src/features/tunnels/ui/TunnelDetailPanel.vue')
const edge = await source('web/src/features/edge-one/ui/AccelerationDomainsPanel.vue')
const saas = await source('web/src/features/saas/model/use-saas-hosts-panel.ts')
const saasJobs = await source('web/src/features/saas/model/use-saas-host-jobs.ts')
const listPage = await source('web/src/shared/lib/use-list-page.ts')
const apiTypes = await source('web/src/shared/api/types.ts')
const rowSelection = await source('web/src/shared/lib/row-selection.ts')

for (const [name, code, reset] of [
  ['records', records, 'records.value = []'],
  ['zones', zones, 'zones.value = []'],
  ['tunnels', tunnels, 'tunnels.value = []'],
  ['tunnel detail routes', tunnelDetail, 'routes.value = []'],
  ['edge domains', edge, 'domains.value = []'],
  ['saas hostnames', saas, 'hostnames.value = []'],
] as const) {
  const resetAt = code.indexOf(reset)
  const scopedLoadAt = code.indexOf('runLoad()', resetAt)
  assert.ok(
    resetAt >= 0 && scopedLoadAt > resetAt,
    `${name} keeps scope-owned rows while loading the replacement scope`
  )
}
assert.match(tunnelDetail, /tunnel\.value = null[\s\S]*routes\.value = \[\][\s\S]*void runLoad\(\)/)
assert.match(edge, /zoneMeta\.value = null[\s\S]*domains\.value = \[\][\s\S]*void runLoad\(\)/)
assert.match(records, /dialogOpen\.value = false[\s\S]*batchEditOpen\.value = false[\s\S]*await runLoad\(\)/)
assert.match(zones, /showAdd\.value = false[\s\S]*await runLoad\(\)/)

assert.match(records, /async function save\(\) \{\s*if \(saving\.value\) return/)
assert.match(zones, /async function createZone\(\) \{\s*if \(adding\.value\) return/)
assert.match(tunnels, /async function createTunnel\(\) \{\s*if \(creating\.value\) return/)
assert.match(tunnelDetail, /async function saveRoute\(\) \{\s*if \(saving\.value\) return/)

assert.match(records, /scopeGeneration\.capture\(\{ provider: \{ \.\.\.props\.provider \}, zoneId: props\.zoneId \}\)/)
assert.match(zones, /scopeGeneration\.capture\(\{[\s\S]*provider: \{ \.\.\.props\.provider \}/)
assert.match(tunnels, /providerGeneration\.capture\(\{ providerId: props\.providerId \}\)/)
assert.match(tunnelDetail, /claim\(\{ providerId: props\.providerId, tunnelId: props\.tunnelId \}\)/)

for (const [name, code] of [
  ['DNS', records],
  ['EdgeOne', edge],
  ['SaaS', saasJobs],
] as const) {
  assert.match(code, /showBatchFailures\([\s\S]*onRetry:/, `${name} recovered failed jobs lost retry`)
}

assert.match(apiTypes, /export type JobStatus =/)
assert.match(apiTypes, /export interface JobCommand/)
assert.match(apiTypes, /export interface MutationSideEffect/)
assert.doesNotMatch(listPage, /silent/)
assert.doesNotMatch(listPage, /ListPageControls/)
assert.match(rowSelection, /export function useRowSelection/, 'row-selection still has consumers and must be preserved')

console.log('frontend-audit-probe=ok')
