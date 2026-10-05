#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/app/lifecycle.js'
import { loadAppConfig, parseCliOverrides } from '../server/app/config.js'

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
  const app = await buildApp({ ...base, dataDir })
  try {
    await app.ready()
    const generated = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8'))
    if (generatedFile) {
      // 首启：只落盘哈希，明文不落盘
      assert.equal(generated.auth.username, 'admin')
      assert.equal(generated.auth.password, undefined, '首启不得写入明文密码')
      assert.ok(String(generated.auth.password_hash).startsWith('scrypt$'), '首启必须写入 scrypt 哈希')
      assert.ok(app.ctx.initialPassword, '首启必须返回初始密码用于日志输出')
      // Windows 无 POSIX 权限位（chmod 仅只读位），权限断言只在 POSIX 平台生效
      if (process.platform !== 'win32') {
        const mode = (await fs.stat(path.join(dataDir, 'config.json'))).mode & 0o777
        assert.equal(mode, 0o600)
      }
      const defaultLogin = await app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { username: 'admin', password: 'admin' },
      })
      assert.equal(defaultLogin.statusCode, 401, '随机初始密码生效后 admin/admin 必须失败')
      expected = { username: 'admin', password: String(app.ctx.initialPassword) }
    } else {
      // 既有明文配置：保持可登录，登录后自动升级为哈希
      assert.equal(generated.auth.username, expected.username)
    }
    const login = await app.inject({ method: 'POST', url: '/api/session', payload: expected })
    assert.equal(login.statusCode, 200)
  } finally {
    await app.close()
  }
}

// 日志级别：默认开启、别名归一为 silent、非法值 fail-fast（避免传给 pino 后启动崩溃）
assert.equal(loadAppConfig({}, {}).logLevel, 'info', '日志默认必须开启')
assert.equal(loadAppConfig({}, { LOG_LEVEL: 'debug' }).logLevel, 'debug')
assert.equal(loadAppConfig({}, { LOG_LEVEL: 'false' }).logLevel, 'silent')
assert.equal(loadAppConfig({}, { LOG_LEVEL: 'OFF' }).logLevel, 'silent')
assert.throws(() => loadAppConfig({}, { LOG_LEVEL: 'nonsense' }), /LOG_LEVEL/)
assert.equal(parseCliOverrides(['--log-level', 'warn']).logLevel, 'warn')
assert.throws(() => parseCliOverrides(['--log-level', 'nonsense']), /log-level/)

const missingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-default-config-missing-'))
const existingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-default-config-existing-'))
try {
  await run(missingDir, { username: 'admin', password: 'admin' }, true)
  const custom = { auth: { username: 'owner', password: 'strong-password' } }
  await fs.writeFile(path.join(existingDir, 'config.json'), `${JSON.stringify(custom, null, 2)}\n`)
  await run(existingDir, custom.auth)
  const preserved = JSON.parse(await fs.readFile(path.join(existingDir, 'config.json'), 'utf8'))
  assert.equal(preserved.auth.username, custom.auth.username)
  assert.equal(preserved.auth.password, undefined, '登录后明文密码必须被哈希替换')
  assert.ok(String(preserved.auth.password_hash).startsWith('scrypt$'), '登录后必须落盘 scrypt 哈希')
  console.log('default-config-probe=ok')
} finally {
  await fs.rm(missingDir, { recursive: true, force: true })
  await fs.rm(existingDir, { recursive: true, force: true })
}
