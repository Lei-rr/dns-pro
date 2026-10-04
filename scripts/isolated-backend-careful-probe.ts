#!/usr/bin/env node
import assert from 'node:assert/strict'
import { ApiError } from '../server/core/http/api-error.js'
import { BaseHttpClient } from '../server/core/http/base-http.client.js'
import { fromDnsOperationResult } from '../server/core/providers/side-effect-result.js'
import { ProviderConnectionService } from '../server/core/providers/provider-connection.service.js'
import type { ProviderRepository } from '../server/core/providers/provider.repository.js'
import type { Provider } from '../server/core/providers/provider.types.js'
import { hashPassword, verifyPassword } from '../server/core/security/password.js'
import {
  parseCloudflareItemResponse,
  parseCloudflareListResponse,
} from '../server/modules/cloudflare/cloudflare-response.schema.js'
import {
  dnspodDomainCreateResponseSchema,
  dnspodDomainListResponseSchema,
  dnspodRecordListResponseSchema,
  dnspodRecordMutationResponseSchema,
} from '../server/modules/dnspod/dns-pod-response.schema.js'
import {
  edgeoneAccelerationDomainCreateResponseSchema,
  edgeoneAccelerationDomainListResponseSchema,
  edgeoneMutationResponseSchema,
  edgeoneZoneListResponseSchema,
} from '../server/modules/edgeone/edge-one-response.schema.js'

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
  callWith(url: string, params?: Record<string, unknown>) {
    return this.request({ url, params })
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

  // 上游路径逃逸：记录 ID / 站点名拼进 URL 路径后，`.`/`..`/`%2e` 段与空段必须在发请求前被拒
  for (const escaped of ['..', '../zones', 'zones/..', '%2e%2e', '%2E%2E/zones', 'a//b', 'https://evil.invalid/']) {
    await assert.rejects(
      new ProbeGateway().callWith(escaped),
      (error: unknown) => error instanceof ApiError && error.code === 'invalid_upstream_path',
      `upstream path escape not rejected: ${escaped}`
    )
  }
  // 反向控制：合法路径不得被误判为逃逸（继续走到 fetch 层）
  await assert.rejects(
    new ProbeGateway().callWith('zones/zone-1'),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code !== 'invalid_upstream_path' &&
      (error.details as Record<string, unknown>).upstream_status === 404
  )
} finally {
  globalThis.fetch = originalFetch
}

// 关联链校验：类型不匹配与引用环都必须在发起连通性探测之前被拒
const linkedProviders = new Map<string, Provider>([
  ['saas-a', { id: 'saas-a', type: 'saas', name: 'SaaS A', cloudflare_provider: 'cf-b' } as Provider],
  ['cf-b', { id: 'cf-b', type: 'cloudflare', name: 'CF B' } as Provider],
  ['dnspod-c', { id: 'dnspod-c', type: 'dnspod', name: 'DNS C' } as Provider],
  ['saas-d', { id: 'saas-d', type: 'saas', name: 'SaaS D', cloudflare_provider: 'dnspod-c' } as Provider],
])
let probeCalls = 0
const probes = {
  dnspodZones: {
    list: async () => {
      probeCalls++
      return { items: [] }
    },
  },
  cloudflareZones: {
    page: async () => {
      probeCalls++
      return { items: [], totalCount: 0 }
    },
  },
  edgeoneZones: {
    zones: async () => {
      probeCalls++
      return { items: [] }
    },
  },
  tunnels: {
    list: async () => {
      probeCalls++
      return { items: [] }
    },
  },
}
const connections = new ProviderConnectionService(
  {
    find: async (id: string) => linkedProviders.get(id),
  } as unknown as ProviderRepository,
  probes
)

const probesBeforeMismatch = probeCalls
await assert.rejects(
  connections.test('saas-d'),
  (error: unknown) =>
    error instanceof ApiError && error.code === 'provider_reference_type_mismatch' && error.statusCode === 422
)
assert.equal(probeCalls, probesBeforeMismatch, '关联类型不匹配不得发起连通性探测')

// 数据上不可能构成环（关联目标类型 dnspod/cloudflare 均为终点），
// 因此用公开的 visited 入参直接验证引用环守卫
await assert.rejects(
  connections.test('saas-a', new Set(['saas-a'])),
  (error: unknown) =>
    error instanceof ApiError &&
    error.code === 'provider_reference_cycle' &&
    error.statusCode === 422 &&
    Array.isArray((error.details as Record<string, unknown>).chain)
)

// 正向控制：合法的 SaaS → Cloudflare 关联必须真的探测
const probesBeforeLinked = probeCalls
const linked = await connections.test('saas-a')
assert.equal(linked.ok, true)
assert.equal(linked.type, 'saas')
assert.equal((linked.details as Record<string, unknown>).cloudflare_provider, 'cf-b')
assert.equal(probeCalls, probesBeforeLinked + 1, '合法关联必须发起一次探测')

console.log('backend-careful-probe=ok')
