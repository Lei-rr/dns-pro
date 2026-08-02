#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { setDataRoot } from '../server/src/platform/storage/json-store.js'
import { normalizeCreateRecords } from '../server/src/workflows/dns-batch/dns-record-payload.js'
import { ProviderPresenter } from '../server/src/modules/providers/provider-presenter.js'
import type { Provider } from '../server/src/modules/providers/provider.types.js'
import { DNS_BATCH_DELETE_JOB } from '../server/src/workflows/dns-batch/dns-batch-job.types.js'
import { EDGEONE_BATCH_DISABLE_JOB } from '../server/src/workflows/edge-one-dns-sync/edge-one-dns-sync-job.types.js'

assert.equal(
  normalizeCreateRecords([
    { name: '@', type: 'TXT', value: 'one', line: '默认' },
    { name: '@', type: 'TXT', value: 'two', line: '默认' },
  ]).length,
  2
)
const presenter = new ProviderPresenter()
const legacy = { id: 'legacy', type: 'legacy', name: 'Legacy', api_token: 'secret' } as unknown as Provider
const legacyView = presenter.present(legacy) as unknown as Record<string, unknown>
assert.equal(legacyView.configured, false)
assert.equal('api_token' in legacyView, false)
const cf = { id: 'cf', type: 'cloudflare', name: 'CF', api_token: 'token', account_id: '' } as Provider
const tunnel = { id: 't', type: 'cloudflared', name: 'Tunnel', cloudflare_provider: 'cf' } as Provider
assert.equal(presenter.present(tunnel, [cf, tunnel]).configured, false)

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-safe-probe-'))
let app: Awaited<ReturnType<typeof buildApp>> | undefined
try {
  await fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ auth: { username: 'u', password: 'p' } }))
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }))
  setDataRoot(dataDir)
  app = await buildApp({
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    sessionSecret: 'safe-probe-session-secret-at-least-32-characters',
    sessionCookieName: 'safe_probe',
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    httpTimeoutMs: 1000,
  })
  await app.ready()
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { username: 'u', password: 'p' } })
  const cookies = login.headers['set-cookie']
  const cookie = String(Array.isArray(cookies) ? cookies.at(-1) : cookies).split(';', 1)[0]
  const dns = await app.ctx.platform.jobs.createTerminalExclusive(
    DNS_BATCH_DELETE_JOB,
    { provider_type: 'cloudflare', provider_id: 'owner-a', zone: 'example.com' },
    [{ id: 'r', status: 'failed' }],
    undefined,
    { status: 'failed', success: 0, failed: 1, skipped: 0 }
  )
  const dnsRead = await app.inject({
    method: 'GET',
    url: `/api/cloudflare/providers/owner-b/records/batch/${dns.id}`,
    headers: { cookie },
  })
  assert.equal(dnsRead.statusCode, 200)
  assert.equal(dnsRead.json().data, null)
  const dnsRetry = await app.inject({
    method: 'POST',
    url: `/api/cloudflare/providers/owner-b/records/batch/${dns.id}/retry`,
    headers: { cookie },
  })
  assert.equal(dnsRetry.statusCode, 404)
  const wrongTypeRead = await app.inject({
    method: 'GET',
    url: `/api/dnspod/providers/owner-a/records/batch/${dns.id}`,
    headers: { cookie },
  })
  assert.equal(wrongTypeRead.statusCode, 200)
  assert.equal(wrongTypeRead.json().data, null)
  const wrongTypeRetry = await app.inject({
    method: 'POST',
    url: `/api/dnspod/providers/owner-a/records/batch/${dns.id}/retry`,
    headers: { cookie },
  })
  assert.equal(wrongTypeRetry.statusCode, 404)
  const edge = await app.ctx.platform.jobs.createTerminalExclusive(
    EDGEONE_BATCH_DISABLE_JOB,
    { provider_id: 'owner-a', zone_id: 'zone-1' },
    [{ domain: 'a.example.com', status: 'failed' }],
    undefined,
    { status: 'failed', success: 0, failed: 1, skipped: 0 }
  )
  const edgeRead = await app.inject({
    method: 'GET',
    url: `/api/edgeone/providers/owner-b/batch/${edge.id}`,
    headers: { cookie },
  })
  assert.equal(edgeRead.statusCode, 200)
  assert.equal(edgeRead.json().data, null)
  const edgeRetry = await app.inject({
    method: 'POST',
    url: `/api/edgeone/providers/owner-b/batch/${edge.id}/retry`,
    headers: { cookie },
  })
  assert.equal(edgeRetry.statusCode, 404)
  const invalidTunnel = await app.inject({
    method: 'GET',
    url: '/api/cloudflared/providers/p/tunnels/invalid.id',
    headers: { cookie },
  })
  assert.equal(invalidTunnel.statusCode, 400)
  console.log('backend-safe-probe=ok')
} finally {
  if (app) await app.close()
  await fs.rm(dataDir, { recursive: true, force: true })
}
