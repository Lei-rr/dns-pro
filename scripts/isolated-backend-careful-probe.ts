#!/usr/bin/env node
import assert from 'node:assert/strict'
import { ApiError } from '../server/src/kernel/http/api-error.js'
import { BaseHttpClient } from '../server/src/kernel/http/base-http.client.js'
import { fromDnsOperationResult } from '../server/src/kernel/providers/side-effect-result.js'
import { hashPassword, verifyPassword } from '../server/src/kernel/security/password.js'
import {
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../server/src/domains/cloudflare/cloudflare-response.schema.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainListResponseSchema,
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
} from '../server/src/domains/dnspod/dns-pod-response.schema.js'
import {
  edgeoneAccelerationDomainCreateResponseSchema,
  edgeoneAccelerationDomainListResponseSchema,
  edgeoneMutationResponseSchema,
  edgeoneZoneListResponseSchema,
} from '../server/src/domains/edgeone/edge-one-response.schema.js'

// 密码以 scrypt 自描述哈希存储，校验不接受错误密码
const stored = hashPassword('correct horse battery staple')
assert.ok(stored.startsWith('scrypt$'), '密码必须以 scrypt 哈希存储')
assert.equal(verifyPassword('correct horse battery staple', stored), true)
assert.equal(verifyPassword('wrong password', stored), false)
assert.equal(verifyPassword('anything', 'plaintext-legacy'), false, '非哈希输入必须校验失败')
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

class ProbeGateway extends BaseHttpClient {
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
