#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { setDataRoot } from '../server/src/platform/storage/json-store.js'

const secret = 'default-config-probe-secret-at-least-32-characters'
const base = {
  host: '127.0.0.1',
  port: 0,
  logLevel: false as const,
  sessionSecret: secret,
  sessionCookieName: 'config_probe',
  sessionMaxAgeSeconds: 3600,
  cookieSecure: false,
  cookieSameSite: 'lax' as const,
  trustProxy: false,
  httpTimeoutMs: 1000,
}

async function run(dataDir: string, expected: { username: string; password: string }, generatedFile = false) {
  setDataRoot(dataDir)
  const app = await buildApp({ ...base, dataDir })
  try {
    await app.ready()
    const generated = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8'))
    assert.deepEqual(generated.auth, expected)
    if (generatedFile) {
      const mode = (await fs.stat(path.join(dataDir, 'config.json'))).mode & 0o777
      assert.equal(mode, 0o600)
    }
    const login = await app.inject({ method: 'POST', url: '/api/session', payload: expected })
    assert.equal(login.statusCode, 200)
  } finally {
    await app.close()
  }
}

const missingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-default-config-missing-'))
const existingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-default-config-existing-'))
try {
  await run(missingDir, { username: 'admin', password: 'admin' }, true)
  const custom = { auth: { username: 'owner', password: 'strong-password' } }
  await fs.writeFile(path.join(existingDir, 'config.json'), `${JSON.stringify(custom, null, 2)}\n`)
  await run(existingDir, custom.auth)
  const preserved = JSON.parse(await fs.readFile(path.join(existingDir, 'config.json'), 'utf8'))
  assert.deepEqual(preserved, custom)
  console.log('default-config-probe=ok')
} finally {
  await fs.rm(missingDir, { recursive: true, force: true })
  await fs.rm(existingDir, { recursive: true, force: true })
}
