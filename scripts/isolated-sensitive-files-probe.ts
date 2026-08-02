#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveSessionSecret } from '../server/src/shared/auth/session-secret.js'
import { JsonStore, setDataRoot } from '../server/src/platform/storage/json-store.js'

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

  console.log('sensitive-files-probe=ok secret=600 json=600 content=unchanged')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
