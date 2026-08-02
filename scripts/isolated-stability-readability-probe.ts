#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ApiError } from '../server/src/shared/http/api-error.js'
import { isExplicitNotFound } from '../server/src/shared/providers/provider-error.js'
import { dnspodDomainListResponseSchema } from '../server/src/modules/dns-pod/dns-pod-response.schema.js'
import { edgeoneZoneListResponseSchema } from '../server/src/modules/edge-one/edge-one-response.schema.js'
import { DnsPodSaaSDriver } from '../server/src/workflows/saas-dns-sync/dns-pod-sync.adapter.js'
import { CloudflareDnsSaaSDriver } from '../server/src/workflows/saas-dns-sync/cloudflare-dns-sync.adapter.js'
import { cloudflareDnsCleanupRecipe } from '../server/src/workflows/saas-dns-sync/saas-dns-cleanup.js'
import { SaaSDnsSyncWorkflow } from '../server/src/workflows/saas-dns-sync/saas-dns-sync.workflow.js'

assert.equal(isExplicitNotFound(new Error('token service not found')), false)
assert.equal(isExplicitNotFound(new Error('provider returned 404')), false)
assert.equal(isExplicitNotFound(new ApiError('provider_not_found', 'Provider not found', 404)), false)
assert.equal(
  isExplicitNotFound(new ApiError('provider_failed', 'upstream missing', 502, { upstream_status: 404 })),
  true
)
assert.equal(
  isExplicitNotFound(new ApiError('cloudflare_request_failed', 'missing', 502, { upstream_status: 500 })),
  false
)
assert.throws(
  () => dnspodDomainListResponseSchema.parse({ DomainList: null }),
  (error: unknown) => error instanceof ApiError && error.code === 'dnspod_invalid_response' && error.statusCode === 502
)
assert.throws(
  () => edgeoneZoneListResponseSchema.parse({ Zones: null }),
  (error: unknown) => error instanceof ApiError && error.code === 'edgeone_invalid_response' && error.statusCode === 502
)
assert.equal(
  isExplicitNotFound(new ApiError('saas_hostname_not_found', 'missing', 404), {
    localCodes: ['saas_hostname_not_found'],
  }),
  true
)

assert.equal(
  isExplicitNotFound(
    new ApiError('dnspod_request_failed', 'missing', 502, { code: 'ResourceNotFound.NoDataOfRecord' }),
    {
      providerCode: /^ResourceNotFound\.NoDataOfRecord$/i,
    }
  ),
  true
)
assert.equal(
  isExplicitNotFound(
    new ApiError('dnspod_request_failed', 'domain missing', 502, { code: 'ResourceNotFound.NoDataOfDomain' }),
    {
      providerCode: /^ResourceNotFound\.NoDataOfRecord$/i,
    }
  ),
  false
)

const recipeHostnames = {
  showHostname: async () => ({
    hostname: 'www.example.com',
    sync_provider_id: 'dns-target',
    custom_origin_server: 'origin.example.net',
    status: 'pending',
    ssl: {},
  }),
  syncConfig: async () => ({}),
}
let recipeZoneError: ApiError = new ApiError('dnspod_request_failed', 'temporary network failure', 502)
const recipeSupport = {
  resolveDnsPodZone: async () => {
    throw recipeZoneError
  },
}
const recipeDriver = new DnsPodSaaSDriver(recipeHostnames as never, recipeSupport as never)
await assert.rejects(
  recipeDriver.collectRecordsFor('saas-owner', 'example.com', 'www.example.com'),
  (error: unknown) => error === recipeZoneError
)
recipeZoneError = new ApiError('saas_dnspod_zone_not_found', 'zone missing', 404)
const missingZoneRecipe = await recipeDriver.collectRecordsFor('saas-owner', 'example.com', 'www.example.com')
assert.ok(missingZoneRecipe.records.every((record) => record.dnspod_zone === ''))

const oldPreferredRecords = [
  {
    type: 'CNAME',
    name: 'www.example.com',
    value: 'old-preferred.example.net',
    purpose: 'preferred_cname',
  },
]
let updateCollectCalls = 0
let resyncBeforeRecords: unknown[] = []
const updateWorkflow = new SaaSDnsSyncWorkflow(
  {
    resolveZoneRef: async () => ({ cloudflareProviderId: 'cf-owner', zoneId: 'zone-1' }),
    updateHostname: async () => ({ id: 'host-1', hostname: 'www.example.com' }),
  } as never,
  {} as never,
  {
    collectSaaSRecords: async () => {
      updateCollectCalls++
      return { hostname_fqdn: 'www.example.com', records: [] }
    },
    resyncSaaSHostname: async (_provider: string, _zone: string, _hostname: string, records: unknown[]) => {
      resyncBeforeRecords = records
      return { status: 'completed', records: [] }
    },
    normalizeSyncSideEffect: (value: unknown) => value,
  } as never
)
await updateWorkflow.updateHostname('saas-owner', 'example.com', 'www.example.com', { auto_preferred: false }, true, {
  remoteApplied: true,
  beforeRecords: oldPreferredRecords,
} as never)
assert.equal(updateCollectCalls, 0, 'retry recollected post-update DNS state')
assert.deepEqual(resyncBeforeRecords, oldPreferredRecords, 'retry lost pre-update DNS snapshot')

let wildcardDeletes = 0
const cloudflareCleanup = new CloudflareDnsSaaSDriver(
  {} as never,
  {} as never,
  { idByName: async () => 'dns-zone-1' } as never,
  {
    findExact: async (_provider: string, _zone: string, name: string, type: string) => [
      { id: `${type}:${name}`, content: 'old.target.example.net', comment: '' },
    ],
    delete: async () => {
      wildcardDeletes++
      return { id: String(wildcardDeletes) }
    },
  } as never
)
const fallbackCleanup = await cloudflareCleanup.cleanup(
  'saas-owner',
  'www.example.com',
  cloudflareDnsCleanupRecipe('www.example.com', 'cf-dns', 'example.com')
)
assert.equal(fallbackCleanup.cleaned, 3, 'value-unknown fallback recipe left orphan DNS records')
assert.equal(wildcardDeletes, 3)

const root = new URL('../', import.meta.url)
const dnsBatch = await readFile(new URL('server/src/workflows/dns-batch/dns-batch.workflow.ts', root), 'utf8')
assert.match(dnsBatch, /isExplicitNotFound\(error,\s*\{\s*providerCode:/)
assert.doesNotMatch(dnsBatch, /not\\s\*found|\\b404\\b/)

const saasHostnames = await readFile(new URL('server/src/modules/saas/saas-hostname.service.ts', root), 'utf8')
const byFqdn =
  saasHostnames.match(
    /private async resolveHostnameByFqdn[\s\S]*?\n  }\n\n  private async extractPreferredDomain/
  )?.[0] || ''
assert.match(byFqdn, /isExplicitNotFound\(error,\s*\{\s*localCodes:/)
assert.doesNotMatch(byFqdn, /catch\s*\{\s*continue/)

const listPage = await readFile(new URL('web/src/shared/lib/use-list-page.ts', root), 'utf8')
assert.match(listPage, /if \(load\.isLatest\(\)\) toast\.success\('已刷新'\)/)

const providerService = await readFile(new URL('server/src/modules/providers/provider.service.ts', root), 'utf8')
assert.match(providerService, /present\([^,]+,\s*(?:providers|savedProviders)\)/)

const guardedEntries = [
  ['web/src/features/providers/ui/ProvidersPanel.vue', 'save'],
  ['web/src/features/saas/model/use-saas-host-editor.ts', 'save'],
  ['web/src/features/saas/ui/PreferredDomainsDialog.vue', 'addDomain'],
  ['web/src/features/saas/ui/PreferredDomainsDialog.vue', 'saveEdit'],
  ['web/src/features/saas/ui/PreferredDomainsDialog.vue', 'move'],
] as const
for (const [file, name] of guardedEntries) {
  const source = await readFile(new URL(file, root), 'utf8')
  const body = source.match(new RegExp(`async function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] || ''
  assert.match(body.slice(0, 180), /if \(saving\.value\) return/, `${file}:${name} lacks a synchronous submit guard`)
}

console.log('stability-readability-probe=ok not-found=structured refresh=owned submits=guarded')
