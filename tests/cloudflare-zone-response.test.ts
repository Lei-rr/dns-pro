import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cloudflareCustomHostnameSchema,
  cloudflareDnsRecordSchema,
  cloudflareTunnelSchema,
  cloudflareZoneSchema,
} from '../src/modules/cloudflare/schemas/response.js'

test('normalizes nullable Cloudflare zone presentation fields', () => {
  const zone = cloudflareZoneSchema.parse({
    id: 'zone-id',
    name: 'example.com',
    status: null,
    paused: null,
    name_servers: null,
    original_name_servers: null,
    created_on: null,
  })

  assert.equal(zone.status, null)
  assert.equal(zone.paused, null)
  assert.deepEqual(zone.name_servers, [])
  assert.deepEqual(zone.original_name_servers, [])
  assert.equal(zone.created_on, null)
})

test('accepts omitted record zone metadata and normalizes nullable fields', () => {
  const record = cloudflareDnsRecordSchema.parse({
    id: 'record-id',
    name: 'www.example.com',
    type: 'A',
    content: '192.0.2.1',
    ttl: 1,
    comment: null,
    tags: null,
    created_on: null,
  })

  assert.equal(record.zone_id, undefined)
  assert.equal(record.zone_name, undefined)
  assert.equal(record.comment, null)
  assert.deepEqual(record.tags, [])
  assert.equal(record.created_on, null)
})

test('normalizes nullable custom-hostname object fields', () => {
  const hostname = cloudflareCustomHostnameSchema.parse({
    id: 'hostname-id',
    hostname: 'app.example.com',
    ssl: null,
    ownership_verification: null,
    custom_metadata: null,
  })

  assert.deepEqual(hostname.ssl, {})
  assert.deepEqual(hostname.ownership_verification, {})
  assert.equal(hostname.custom_metadata, null)
})

test('normalizes nullable tunnel presentation fields', () => {
  const tunnel = cloudflareTunnelSchema.parse({
    id: 'tunnel-id',
    name: 'edge',
    status: null,
    remote_config: null,
    connections: null,
    conns_active_at: null,
  })

  assert.equal(tunnel.status, null)
  assert.equal(tunnel.remote_config, null)
  assert.deepEqual(tunnel.connections, [])
  assert.equal(tunnel.conns_active_at, null)
})
