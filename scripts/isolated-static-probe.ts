#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { setDataRoot } from '../server/src/platform/storage/json-store.js'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-static-probe-'))
await fs.writeFile(
  path.join(dataDir, 'config.json'),
  JSON.stringify({ auth: { username: 'probe', password: 'probe' } })
)
await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }))

setDataRoot(dataDir)
const app = await buildApp({
  host: '127.0.0.1',
  port: 0,
  logLevel: false,
  dataDir,
  sessionSecret: 'static-probe-session-secret-that-is-longer-than-thirty-two-characters',
  sessionCookieName: 'dns_static_probe',
  sessionMaxAgeSeconds: 3600,
  cookieSecure: false,
  cookieSameSite: 'lax',
  trustProxy: false,
  httpTimeoutMs: 1000,
})

try {
  const root = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } })
  assert.equal(root.statusCode, 200)
  assert.match(String(root.headers['content-type']), /^text\/html/)
  assert.match(String(root.headers['cache-control']), /no-store/)

  const references = [...root.body.matchAll(/(?:src|href)="(\/[^"?#]+)["?#]/g)].map((match) => match[1])
  assert.ok(references.length > 0)
  for (const reference of references) {
    const response = await app.inject({ method: 'GET', url: reference })
    assert.equal(response.statusCode, 200, reference)
    assert.doesNotMatch(String(response.headers['content-type']), /^text\/html/, reference)
  }

  const asset = references.find((reference) => reference.startsWith('/assets/'))
  assert.ok(asset)
  const assetResponse = await app.inject({ method: 'GET', url: asset })
  assert.match(String(assetResponse.headers['cache-control']), /immutable/)

  const missingAsset = await app.inject({ method: 'GET', url: '/assets/definitely-missing.js' })
  assert.equal(missingAsset.statusCode, 404)
  assert.match(String(missingAsset.headers['content-type']), /^application\/json/)

  const deepLink = await app.inject({
    method: 'GET',
    url: '/providers/deep-link',
    headers: { accept: 'text/html' },
  })
  assert.equal(deepLink.statusCode, 200)
  assert.match(String(deepLink.headers['content-type']), /^text\/html/)

  const apiMissing = await app.inject({ method: 'GET', url: '/api/definitely-missing' })
  assert.equal(apiMissing.statusCode, 404)
  assert.equal(apiMissing.json().code, 'not_found')

  console.log(`static-probe=ok references=${references.length}`)
} finally {
  await app.close()
  await fs.rm(dataDir, { recursive: true, force: true })
}
