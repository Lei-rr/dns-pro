#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/app/build.js'
import { resolveSessionSecret } from '../server/core/security/session-secret.js'
import { JsonStore } from '../server/core/store/json-store.js'
import type { AppConfig } from '../server/app/config.js'

const mode = async (file: string) => (await fs.stat(file)).mode & 0o777
/** Windows 无 POSIX 权限位（chmod 仅只读位），权限断言只在 POSIX 平台生效 */
const assertPrivate = async (file: string, message: string) => {
  if (process.platform === 'win32') return
  assert.equal(await mode(file), 0o600, message)
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-sensitive-'))

try {
  const generatedSecret = await resolveSessionSecret(root, '')
  const secretPath = path.join(root, 'session-secret')
  await assertPrivate(secretPath, 'new session secret must be private')

  await fs.chmod(secretPath, 0o644)
  const secretBefore = await fs.readFile(secretPath, 'utf8')
  assert.equal(await resolveSessionSecret(root, ''), generatedSecret)
  await assertPrivate(secretPath, 'existing session secret must be made private')
  assert.equal(await fs.readFile(secretPath, 'utf8'), secretBefore)

  const store = new JsonStore('probe/store-probe.json', { items: [] as Array<{ id: string }> }, root)
  await store.write({ items: [{ id: 'one' }] })
  const storePath = path.join(root, 'probe/store-probe.json')
  await assertPrivate(storePath, 'new JSON store file must be private')

  await fs.chmod(storePath, 0o644)
  const storeBefore = await fs.readFile(storePath, 'utf8')
  store.invalidateMemory()
  assert.deepEqual(await store.read(), { items: [{ id: 'one' }] })
  await assertPrivate(storePath, 'existing JSON store file must be made private')
  assert.equal(await fs.readFile(storePath, 'utf8'), storeBefore)

  const coldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-sensitive-cold-'))
  try {
    const files = [
      // 预置哈希（无明文），冷启动不应改写该文件
      [
        'config.json',
        {
          auth: {
            username: 'existing',
            password_hash: 'scrypt$16384$8$1$Y2FsaWJyYXRpb24tc2FsdA==$Y2FsaWJyYXRpb24taGFzaA==',
          },
        },
      ],
      ['providers.json', { items: [] }],
      ['saas/preferred-domains.json', { items: ['example.com'] }],
      ['saas/preferences.json', { items: {} }],
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
      await assertPrivate(filePath, `${file} must be private immediately after startup`)
      assert.equal(await fs.readFile(filePath, 'utf8'), before.get(file))
    }
  } finally {
    await fs.rm(coldRoot, { recursive: true, force: true })
  }

  console.log('sensitive-files-probe=ok secret=600 json=600 cold-start=600 content=unchanged')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
