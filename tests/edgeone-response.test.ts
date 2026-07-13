import assert from 'node:assert/strict'
import test from 'node:test'
import {
  edgeOneAccelerationDomainSchema,
  edgeOneZoneSchema,
  edgeoneZoneListResponseSchema,
} from '../src/lib/providers/edgeone-response.js'

test('normalizes nullable EdgeOne zone presentation fields', () => {
  const zone = edgeOneZoneSchema.parse({
    ZoneId: 'zone-1',
    ZoneName: 'example.com',
    Status: null,
    Paused: null,
    CreatedOn: null,
  })

  assert.equal(zone.Status, null)
  assert.equal(zone.Paused, null)
  assert.equal(zone.CreatedOn, null)
})

test('normalizes nullable EdgeOne acceleration domain fields', () => {
  const domain = edgeOneAccelerationDomainSchema.parse({
    DomainName: 'www.example.com',
    DomainStatus: null,
    HttpOriginPort: null,
    OriginDetail: null,
    Certificate: null,
  })

  assert.equal(domain.DomainStatus, null)
  assert.equal(domain.HttpOriginPort, null)
  assert.deepEqual(domain.OriginDetail, {})
  assert.deepEqual(domain.Certificate, {})
})

test('normalizes nullable EdgeOne list envelopes', () => {
  const list = edgeoneZoneListResponseSchema.parse({
    Zones: null,
    TotalCount: null,
    RequestId: null,
  })

  assert.deepEqual(list.Zones, [])
  assert.equal(list.TotalCount, null)
  assert.equal(list.RequestId, null)
})
