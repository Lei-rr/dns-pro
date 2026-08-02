#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const statusModule = (await import('../web/src/features/edge-one/lib/status.js')) as Record<string, unknown>
const httpsStatusLabel = statusModule.edgeOneHttpsStatusLabel as
  | ((certificate?: { mode?: string; items?: Array<{ status?: string }>; list?: Array<{ status?: string }> }) => string)
  | undefined

assert.equal(typeof httpsStatusLabel, 'function', 'EdgeOne HTTPS status formatter is missing')
assert.equal(httpsStatusLabel?.(), '未开启')
assert.equal(httpsStatusLabel?.({ mode: 'disable' }), '未开启')
assert.equal(httpsStatusLabel?.({ mode: 'eofreecert', items: [{ status: 'applying' }] }), '申请中')
assert.equal(httpsStatusLabel?.({ mode: 'sslcert', list: [{ status: 'deployed' }] }), '已部署')
assert.equal(httpsStatusLabel?.({ mode: 'eofreecert', items: [] }), '已开启')

const table = await readFile(
  new URL('../web/src/features/edge-one/ui/AccelerationDomainsTable.vue', import.meta.url),
  'utf8'
)
assert.match(table, /<TableHead>HTTPS<\/TableHead>/, 'acceleration-domain table is missing HTTPS column')
assert.match(table, /edgeOneHttpsStatusLabel\(record\.certificate\)/, 'HTTPS column is not driven by certificate state')
assert.match(table, /<TableCell colspan="7"/, 'empty-row colspan must include HTTPS column')

console.log('edgeone-https-status-probe=ok')
