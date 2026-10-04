#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  buildAccelerationDomainRequest,
  normalizeAccelerationDomainPayload,
} from '../server/src/domains/edgeone/edge-one-domain-payload.js'

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
assert.throws(
  () => normalizeAccelerationDomainPayload({}),
  (error: any) => error?.code === 'validation_failed'
)
console.log('edgeone-payload-probe=ok')
