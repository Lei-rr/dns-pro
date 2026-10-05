#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  buildAccelerationDomainRequest,
  normalizeAccelerationDomainPayload,
  normalizeAccelerationDomainUpdatePayload,
} from '../server/modules/edgeone/edge-one-domain-payload.js'

const normalized = normalizeAccelerationDomainPayload({
  domain_name: ' WWW.Example.COM ',
  origin: ' 192.0.2.1 ',
  host_header: ' ORIGIN.Example.COM ',
})
assert.deepEqual(normalized, {
  domain_name: 'www.example.com',
  origin: '192.0.2.1',
  origin_type: 'IP_DOMAIN',
  host_header: 'origin.example.com',
  origin_protocol: 'FOLLOW',
  http_origin_port: 80,
  https_origin_port: 443,
  ipv6_status: 'follow',
})
assert.deepEqual(buildAccelerationDomainRequest('zone-1', normalized), {
  ZoneId: 'zone-1',
  DomainName: 'www.example.com',
  OriginInfo: { OriginType: 'IP_DOMAIN', Origin: '192.0.2.1', HostHeader: 'origin.example.com' },
  OriginProtocol: 'FOLLOW',
  IPv6Status: 'follow',
  HttpOriginPort: 80,
  HttpsOriginPort: 443,
})
const httpsOnly = buildAccelerationDomainRequest('zone-1', { ...normalized, origin_protocol: 'HTTPS' })
assert.equal(httpsOnly.HttpOriginPort, undefined)
assert.equal(httpsOnly.HttpsOriginPort, 443)

// 更新路径的空 HostHeader：必须原样下发（ModifyAccelerationDomain 缺省字段=保持原配置，
// 丢掉空串等于用户点「清空自定义 HOST」后旧值还留在上游）
assert.deepEqual(
  buildAccelerationDomainRequest(
    'zone-1',
    { domain_name: 'www.example.com', origin_type: 'IP_DOMAIN', origin: '192.0.2.1', host_header: '' },
    'update'
  ).OriginInfo,
  { OriginType: 'IP_DOMAIN', Origin: '192.0.2.1', HostHeader: '' },
  '更新路径必须下发空串 HostHeader'
)
// 更新路径未提供 host_header：不得凭空补空串（否则每次改源站都会重置 HOST）
assert.deepEqual(
  buildAccelerationDomainRequest('zone-1', { domain_name: 'www.example.com', origin: '192.0.2.1' }, 'update')
    .OriginInfo,
  { Origin: '192.0.2.1' },
  '未提供 HostHeader 时不得下发'
)
// 创建路径没有旧值可清空：空串仍省略，避免上游对空串报错
assert.deepEqual(
  buildAccelerationDomainRequest('zone-1', { ...normalized, host_header: '' }).OriginInfo,
  { OriginType: 'IP_DOMAIN', Origin: '192.0.2.1' },
  '创建路径的空串只表示默认回源 HOST，不下发'
)
// 归一化侧保留空串（清空表达不能被 trim 掉）
assert.equal(
  normalizeAccelerationDomainUpdatePayload({ domain_name: 'WWW.Example.com.', host_header: '   ' }).host_header,
  '',
  '更新归一化必须保留空串表达'
)
assert.throws(
  () => normalizeAccelerationDomainPayload({}),
  (error: any) => error?.code === 'validation_failed'
)
console.log('edgeone-payload-probe=ok')
