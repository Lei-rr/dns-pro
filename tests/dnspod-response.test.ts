import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dnspodDomainSchema,
  dnspodRecordSchema,
} from '../src/lib/providers/dnspod-response.js'

test('normalizes nullable DNSPod record presentation fields', () => {
  const record = dnspodRecordSchema.parse({
    RecordId: 1,
    Name: '@',
    Type: 'A',
    Value: '1.2.3.4',
    TTL: null,
    MX: null,
    Weight: null,
    Remark: null,
    DefaultNS: null,
  })

  assert.equal(record.TTL, null)
  assert.equal(record.MX, null)
  assert.equal(record.Weight, null)
  assert.equal(record.Remark, null)
  assert.equal(record.DefaultNS, null)
})

test('normalizes nullable DNSPod domain presentation fields', () => {
  const domain = dnspodDomainSchema.parse({
    DomainId: 1,
    Name: 'example.com',
    RecordCount: null,
    TTL: null,
    Remark: null,
    EffectiveDNS: null,
  })

  assert.equal(domain.RecordCount, null)
  assert.equal(domain.TTL, null)
  assert.equal(domain.Remark, null)
  assert.deepEqual(domain.EffectiveDNS, [])
})
