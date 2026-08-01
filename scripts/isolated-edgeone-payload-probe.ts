#!/usr/bin/env node
import assert from 'node:assert/strict'
import {
  buildEdgeOneOriginInfo,
  normalizeAccelerationDomainPayload,
} from '../src/modules/edge-one/edge-one-domain-payload.js'

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
assert.deepEqual(buildEdgeOneOriginInfo(normalized), {
  OriginType: 'IP_DOMAIN',
  Origin: '192.0.2.1',
  HostHeader: 'origin.example.com',
})
assert.throws(
  () => normalizeAccelerationDomainPayload({}),
  (error: any) => error?.code === 'validation_failed'
)
console.log('edgeone-payload-probe=ok')
