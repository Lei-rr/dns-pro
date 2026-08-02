#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { resolveSessionSecret } from '../server/src/shared/auth/session-secret.js'
import { JsonStore, setDataRoot } from '../server/src/platform/storage/json-store.js'
import type { AppConfig } from '../server/src/bootstrap/app-config.js'

const mode = async (file: string) => (await fs.stat(file)).mode & 0o777
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-sensitive-'))

try {
  setDataRoot(root)

  const generatedSecret = await resolveSessionSecret(root, '')
  const secretPath = path.join(root, 'session-secret')
  assert.equal(await mode(secretPath), 0o600, 'new session secret must be private')

  await fs.chmod(secretPath, 0o644)
  const secretBefore = await fs.readFile(secretPath, 'utf8')
  assert.equal(await resolveSessionSecret(root, ''), generatedSecret)
  assert.equal(await mode(secretPath), 0o600, 'existing session secret must be made private')
  assert.equal(await fs.readFile(secretPath, 'utf8'), secretBefore)

  const store = new JsonStore('jobs/jobs.json', { items: [] as Array<{ id: string }> }, root)
  await store.write({ items: [{ id: 'one' }] })
  const storePath = path.join(root, 'jobs/jobs.json')
  assert.equal(await mode(storePath), 0o600, 'new JSON store file must be private')

  await fs.chmod(storePath, 0o644)
  const storeBefore = await fs.readFile(storePath, 'utf8')
  store.invalidateMemory()
  assert.deepEqual(await store.read(), { items: [{ id: 'one' }] })
  assert.equal(await mode(storePath), 0o600, 'existing JSON store file must be made private')
  assert.equal(await fs.readFile(storePath, 'utf8'), storeBefore)

  const coldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-sensitive-cold-'))
  try {
    const files = [
      ['config.json', { auth: { username: 'existing', password: 'existing' } }],
      ['providers.json', { items: [] }],
      ['saas/preferred-domains.json', { items: ['example.com'] }],
      ['saas/preferences.json', { items: {} }],
      ['jobs/jobs.json', { items: [] }],
    ] as const
    for (const [file, value] of files) {
      const filePath = path.join(coldRoot, file)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 })
    }
    const before = new Map(
      await Promise.all(
        files.map(async ([file]) => [file, await fs.readFile(path.join(coldRoot, file), 'utf8')] as const)
      )
    )
    setDataRoot(coldRoot)
    const config: AppConfig = {
      host: '127.0.0.1',
      port: 0,
      logLevel: false,
      dataDir: coldRoot,
      sessionSecret: await resolveSessionSecret(coldRoot, ''),
      sessionCookieName: 'probe',
      sessionMaxAgeSeconds: 3600,
      cookieSecure: false,
      cookieSameSite: 'lax',
      trustProxy: false,
      httpTimeoutMs: 1000,
    }
    const app = await buildApp(config)
    await app.close()
    for (const [file] of files) {
      const filePath = path.join(coldRoot, file)
      assert.equal(await mode(filePath), 0o600, `${file} must be private immediately after startup`)
      assert.equal(await fs.readFile(filePath, 'utf8'), before.get(file))
    }
  } finally {
    await fs.rm(coldRoot, { recursive: true, force: true })
  }

  console.log('sensitive-files-probe=ok secret=600 json=600 cold-start=600 content=unchanged')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
