import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../../app/lifecycle.js'
import { makeTempDataDir, testAppConfig } from '../../app/test-helpers.js'
import { JsonStore } from '../store/json-store.js'
import { resolveSessionSecret } from './session-secret.js'

/**
 * 敏感文件权限（迁移自 scripts/isolated-sensitive-files-probe.ts）：
 * session-secret 与各数据文件在首次落盘与「已有文件被放宽权限」两种情况下都必须是 0600，
 * 且收紧权限的过程不得改写文件内容（首启与冷启动都不允许把既有数据重写一遍）。
 */

const assertPrivate = async (file: string, message: string): Promise<void> => {
  // Windows 无 POSIX 权限位，权限断言只在 POSIX 平台生效
  if (process.platform === 'win32') return
  expect((await fs.stat(file)).mode & 0o777, message).toBe(0o600)
}

describe('敏感文件的权限收口', () => {
  it('session-secret：新建即 0600；已存在文件复用时收紧权限且内容不变', async () => {
    const root = await makeTempDataDir('dns-sensitive-')
    const generatedSecret = await resolveSessionSecret(root, '')
    const secretPath = path.join(root, 'session-secret')
    await assertPrivate(secretPath, 'new session secret must be private')

    await fs.chmod(secretPath, 0o644)
    const before = await fs.readFile(secretPath, 'utf8')
    expect(await resolveSessionSecret(root, '')).toBe(generatedSecret)
    await assertPrivate(secretPath, 'existing session secret must be made private')
    expect(await fs.readFile(secretPath, 'utf8')).toBe(before)
  })

  it('JSON store：写入文件即 0600；内存缓存失效后重读会再次收紧权限且内容不变', async () => {
    const root = await makeTempDataDir('dns-sensitive-')
    const store = new JsonStore('probe/store-probe.json', { items: [] as Array<{ id: string }> }, root)
    await store.write({ items: [{ id: 'one' }] })
    const storePath = path.join(root, 'probe/store-probe.json')
    await assertPrivate(storePath, 'new JSON store file must be private')

    await fs.chmod(storePath, 0o644)
    const before = await fs.readFile(storePath, 'utf8')
    store.invalidateMemory()
    expect(await store.read()).toEqual({ items: [{ id: 'one' }] })
    await assertPrivate(storePath, 'existing JSON store file must be made private')
    expect(await fs.readFile(storePath, 'utf8')).toBe(before)
  })

  it('冷启动：所有既有数据文件立即收紧为私有，内容原样保留', async () => {
    const coldRoot = await makeTempDataDir('dns-sensitive-cold-')
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

    const config = testAppConfig(coldRoot, { sessionSecret: await resolveSessionSecret(coldRoot, '') })
    const app = await buildApp(config)
    await app.close()

    for (const [file] of files) {
      const filePath = path.join(coldRoot, file)
      await assertPrivate(filePath, `${file} must be private immediately after startup`)
      expect(await fs.readFile(filePath, 'utf8')).toBe(before.get(file))
    }
  })
})
