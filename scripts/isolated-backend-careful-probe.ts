#!/usr/bin/env node
import assert from 'node:assert/strict'
import { ApiError } from '../src/shared/http/api-error.js'
import { BaseGateway } from '../src/shared/providers/base.client.js'
import { fromDnsOperationResult } from '../src/shared/providers/side-effect-result.js'
import { DEFAULT_APP_CONFIG } from '../src/modules/auth/auth-config.repository.js'
import {
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../src/modules/cloudflare/cloudflare-response.schema.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainListResponseSchema,
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
} from '../src/modules/dns-pod/dns-pod-response.schema.js'
import {
  edgeoneAccelerationDomainCreateResponseSchema,
  edgeoneAccelerationDomainListResponseSchema,
  edgeoneMutationResponseSchema,
  edgeoneZoneListResponseSchema,
} from '../src/modules/edge-one/edge-one-response.schema.js'

assert.deepEqual(DEFAULT_APP_CONFIG.auth, { username: 'admin', password: 'admin' })
assert.equal(fromDnsOperationResult({ action: 'completed', records: [{ status: 'failed' }] }, 'done').status, 'failed')
for (const [label, parse, malformed] of [
  ['cf-list-empty', parseCloudflareListResponse, {}],
  ['cf-list-object', parseCloudflareListResponse, { result: {} }],
  ['cf-item-empty', parseCloudflareItemResponse, { result: {} }],
  ['dnspod-domains', dnspodDomainListResponseSchema.parse, {}],
  ['dnspod-records', dnspodRecordListResponseSchema.parse, { RecordList: null }],
  ['dnspod-create', dnspodDomainCreateResponseSchema.parse, { RequestId: 'only' }],
  ['dnspod-mutation', dnspodRecordMutationResponseSchema.parse, { RequestId: 'only' }],
  ['edge-zones', edgeoneZoneListResponseSchema.parse, {}],
  ['edge-domains', edgeoneAccelerationDomainListResponseSchema.parse, { AccelerationDomains: null }],
  ['edge-create', edgeoneAccelerationDomainCreateResponseSchema.parse, {}],
  ['edge-mutation', edgeoneMutationResponseSchema.parse, {}],
] as const)
  assert.throws(() => parse(malformed), undefined, label)

class ProbeGateway extends BaseGateway {
  constructor() {
    super({ baseURL: 'https://provider.invalid' })
  }
  call() {
    return this.request({ url: 'resource' })
  }
}
const originalFetch = globalThis.fetch
globalThis.fetch = async () =>
  new Response('{"error":"missing"}', {
    status: 404,
    statusText: 'Not Found',
    headers: { 'content-type': 'application/json' },
  })
try {
  await assert.rejects(
    new ProbeGateway().call(),
    (error: unknown) =>
      error instanceof ApiError &&
      error.statusCode === 400 &&
      (error.details as Record<string, unknown>).upstream_status === 404
  )
} finally {
  globalThis.fetch = originalFetch
}
console.log('backend-careful-probe=ok')
