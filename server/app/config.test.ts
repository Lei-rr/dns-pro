import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from './lifecycle.js'
import { loadAppConfig, parseCliOverrides } from './config.js'

/**
 * TRUST_PROXY=true 会被 Fastify 原样当作「信任任意转发头」：
 * 直连客户端带一个 X-Forwarded-For 就能冒充来源 IP，
 * 按 IP 的失败计数、账号锁定与登录限流键全部失效，因此环境变量侧直接拒绝。
 */

describe('TRUST_PROXY 解析', () => {
  it('拒绝 true（含大小写变体）', () => {
    expect(() => loadAppConfig({}, { TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/)
    expect(() => loadAppConfig({}, { TRUST_PROXY: 'TRUE' })).toThrow(/TRUST_PROXY/)
  })

  it('仍拒绝数字跳数', () => {
    expect(() => loadAppConfig({}, { TRUST_PROXY: '2' })).toThrow(/TRUST_PROXY/)
  })

  it('false 与可信网段列表照常可用', () => {
    expect(loadAppConfig({}, { TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    expect(loadAppConfig({}, { TRUST_PROXY: '127.0.0.1, 10.0.0.0/8' }).trustProxy).toEqual(['127.0.0.1', '10.0.0.0/8'])
    expect(loadAppConfig({}, {}).trustProxy).toBe(false)
  })

  it('程序内 overrides 仍可显式传 boolean（探针与嵌入式装配用）', () => {
    expect(loadAppConfig({ trustProxy: true }, {}).trustProxy).toBe(true)
  })
})

/** 迁移自 scripts/isolated-default-config-probe.ts：日志级别默认值与命令行解析 */
describe('日志级别解析', () => {
  it('默认开启；false/off 归一为 silent；非法值 fail-fast（避免传给 pino 后启动崩溃）', () => {
    expect(loadAppConfig({}, {}).logLevel).toBe('info')
    expect(loadAppConfig({}, { LOG_LEVEL: 'debug' }).logLevel).toBe('debug')
    expect(loadAppConfig({}, { LOG_LEVEL: 'false' }).logLevel).toBe('silent')
    expect(loadAppConfig({}, { LOG_LEVEL: 'OFF' }).logLevel).toBe('silent')
    expect(() => loadAppConfig({}, { LOG_LEVEL: 'nonsense' })).toThrow(/LOG_LEVEL/)
  })

  it('命令行 --log-level 与 loadAppConfig 同口径：合法归一、非法 fail-fast', () => {
    expect(parseCliOverrides(['--log-level', 'warn']).logLevel).toBe('warn')
    expect(() => parseCliOverrides(['--log-level', 'nonsense'])).toThrow(/log-level/)
  })
})

/** 迁移自 scripts/isolated-default-config-probe.ts：首启与既有明文配置的凭据落盘语义 */
describe('初始账号配置', () => {
  const tempDirs: string[] = []
  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })
  const tempDir = async (prefix: string) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  const base = {
    host: '127.0.0.1',
    port: 0,
    logLevel: false as const,
    sessionSecret: 'default-config-test-secret-at-least-32-characters',
    sessionCookieName: 'config_test',
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax' as const,
    trustProxy: false,
    httpTimeoutMs: 1000,
  }

  type AuthFile = { auth: { username?: string; password?: string; password_hash?: string } }

  async function run(dataDir: string, expected: { username: string; password: string }, generatedFile = false) {
    const app = await buildApp({ ...base, dataDir })
    try {
      await app.ready()
      const generated = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8')) as AuthFile
      if (generatedFile) {
        // 首启：只落盘哈希，明文不落盘
        expect(generated.auth.username).toBe('admin')
        expect(generated.auth.password).toBeUndefined()
        expect(String(generated.auth.password_hash)).toMatch(/^scrypt\$/)
        expect(app.ctx.initialPassword).toBeTruthy()
        // Windows 无 POSIX 权限位（chmod 仅只读位），权限断言只在 POSIX 平台生效
        if (process.platform !== 'win32') {
          const mode = (await fs.stat(path.join(dataDir, 'config.json'))).mode & 0o777
          expect(mode).toBe(0o600)
        }
        const defaultLogin = await app.inject({
          method: 'POST',
          url: '/api/session',
          payload: { username: 'admin', password: 'admin' },
        })
        expect(defaultLogin.statusCode).toBe(401)
        expected = { username: 'admin', password: String(app.ctx.initialPassword) }
      } else {
        // 既有明文配置：保持可登录，登录后自动升级为哈希
        expect(generated.auth.username).toBe(expected.username)
      }
      const login = await app.inject({ method: 'POST', url: '/api/session', payload: expected })
      expect(login.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  }

  it('首启：随机初始密码生效，明文不落盘，admin/admin 必须失败', async () => {
    const missingDir = await tempDir('dns-default-config-missing-')
    await run(missingDir, { username: 'admin', password: 'admin' }, true)
  })

  it('既有明文配置：登录成功后明文密码被 scrypt 哈希替换', async () => {
    const existingDir = await tempDir('dns-default-config-existing-')
    const custom = { auth: { username: 'owner', password: 'strong-password' } }
    await fs.writeFile(path.join(existingDir, 'config.json'), `${JSON.stringify(custom, null, 2)}\n`)
    await run(existingDir, custom.auth)
    const preserved = JSON.parse(await fs.readFile(path.join(existingDir, 'config.json'), 'utf8')) as AuthFile
    expect(preserved.auth.username).toBe(custom.auth.username)
    expect(preserved.auth.password).toBeUndefined()
    expect(String(preserved.auth.password_hash)).toMatch(/^scrypt\$/)
  })
})
