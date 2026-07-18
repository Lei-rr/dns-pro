import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRecordNames } from './record-names.js'

test('splits host records by English and Chinese commas', () => {
  assert.deepEqual(parseRecordNames('www,ggg，api'), ['www', 'ggg', 'api'])
})

test('trims, removes empty entries, and deduplicates while preserving order', () => {
  assert.deepEqual(parseRecordNames(' www, ,ggg,www，@ '), ['www', 'ggg', '@'])
})

test('blank input returns no records instead of defaulting to @', () => {
  assert.deepEqual(parseRecordNames('   '), [])
})
