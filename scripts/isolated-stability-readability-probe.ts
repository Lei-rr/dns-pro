#!/usr/bin/env node
import assert from 'node:assert/strict'
import { DnsWriter } from '../server/src/use-cases/derived-records/dns-writer.js'
import { cloudflareRecordPort } from '../server/src/domains/cloudflare/dns/cloudflare-record.adapter.js'

import { ApiError } from '../server/src/kernel/http/api-error.js'
import { isExplicitNotFound } from '../server/src/kernel/providers/provider-error.js'
import { dnspodDomainListResponseSchema } from '../server/src/domains/dnspod/dns-pod-response.schema.js'
import { edgeoneZoneListResponseSchema } from '../server/src/domains/edgeone/edge-one-response.schema.js'
import { DnsPodSaaSSyncAdapter } from '../server/src/use-cases/saas-dns-sync/dns-pod-saas-sync.adapter.js'
import { CloudflareDnsSaaSSyncAdapter } from '../server/src/use-cases/saas-dns-sync/cloudflare-dns-saas-sync.adapter.js'
import { cloudflareDnsCleanupRecipe } from '../server/src/use-cases/saas-dns-sync/saas-sync-records.js'
import { SaaSDnsSyncWorkflow } from '../server/src/use-cases/saas-dns-sync/saas-dns-sync.workflow.js'

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
  syncConfig: async () => ({ sync_zone: '' }),
  fallbackOrigin: async () => null,
}
let recipeZoneError: ApiError = new ApiError('dnspod_request_failed', 'temporary network failure', 502)
const recipeAccess = { linkedProviderId: async () => 'dns-target' }
const recipeCatalog = {
  resolve: async () => {
    throw recipeZoneError
  },
}
const recipeDriver = new DnsPodSaaSSyncAdapter(
  recipeHostnames as never,
  recipeAccess as never,
  recipeCatalog as never,
  {} as never
)
await assert.rejects(
  recipeDriver.collectRecordsFor('saas-owner', 'example.com', 'www.example.com'),
  (error: unknown) => error === recipeZoneError
)
recipeZoneError = new ApiError('saas_dnspod_zone_not_found', 'zone missing', 404)
const missingZoneRecipe = await recipeDriver.collectRecordsFor('saas-owner', 'example.com', 'www.example.com')
assert.ok(missingZoneRecipe.records.every((record) => record.zone === ''))

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
    collect: async () => {
      updateCollectCalls++
      return { hostname_fqdn: 'www.example.com', records: [] }
    },
    resync: async (_provider: string, _zone: string, _hostname: string, records: unknown[]) => {
      resyncBeforeRecords = records
      return { status: 'completed', records: [] }
    },
  } as never
)
await updateWorkflow.updateHostname('saas-owner', 'example.com', 'www.example.com', { auto_preferred: false }, true, {
  completed: ['before-records-saved', 'remote-applied'],
  beforeRecords: oldPreferredRecords,
} as never)
assert.equal(updateCollectCalls, 0, 'retry recollected post-update DNS state')
assert.deepEqual(resyncBeforeRecords, oldPreferredRecords, 'retry lost pre-update DNS snapshot')

let wildcardDeletes = 0
// 人工记录（无备注）归属不明：即使同名同类型也不得删除
const manualRecord = {
  id: 'CNAME:www.example.com',
  name: 'www.example.com',
  type: 'CNAME',
  content: 'old.target.example.net',
  comment: '',
}
// 本流程写入的记录：备注可证明归属，应被清理
const ownedRecord = {
  id: 'TXT:_cf-custom-hostname.www.example.com',
  name: '_cf-custom-hostname.www.example.com',
  type: 'TXT',
  content: 'verify-token',
  comment: '所有权验证丨www.example.com',
}
const cfZone = { idByName: async () => 'dns-zone-1' } as never
const cfRecords = {
  findExact: async (_provider: string, _zone: string, name: string, type: string) =>
    [manualRecord, ownedRecord].filter((row) => row.name === name && row.type === type),
  delete: async () => {
    wildcardDeletes++
    return { id: String(wildcardDeletes) }
  },
} as never
const writer = new DnsWriter({ cloudflare: cloudflareRecordPort(cfZone, cfRecords) }, { claimsFor: async () => [] })
const cloudflareCleanup = new CloudflareDnsSaaSSyncAdapter({} as never, {} as never, cfZone, writer)
const fallbackCleanup = await cloudflareCleanup.cleanup(
  'saas-owner',
  'www.example.com',
  cloudflareDnsCleanupRecipe('www.example.com', 'cf-dns', 'example.com')
)
assert.equal(fallbackCleanup.cleaned, 1, 'fallback recipe must clean the records it owns')
assert.equal(wildcardDeletes, 1, 'cleanup touched a record it does not own')

console.log('stability-readability-probe=ok not-found=structured refresh=owned')
