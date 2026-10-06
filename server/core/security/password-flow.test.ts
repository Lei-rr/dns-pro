import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp, cookieLineOf, makeTempDataDir } from '../../app/test-helpers.js'

/**
 * 密码存储与强制改密（迁移自 scripts/isolated-password-probe.ts）：
 * 首启随机密码 / 默认凭据拦截 / 改密后的会话与凭据状态。
 *
 * 「改密 → 吊销旧会话 → 重启复验」是阶段重放流程：重启段的断言依赖改密阶段留下的磁盘状态，
 * 因此整段留在同一个 it 内顺序执行，不拆成互相依赖的多个 it。
 */

const ADMIN = 'admin'
const NEW_PASSWORD = 'brand-new-password'
const CONFIG_FILE = 'config.json'
const DEFAULT_HASH = /^scrypt\$/

const apps: FastifyInstance[] = []

/** 创建并登记实例，afterEach 统一关闭 */
async function startApp(dataDir: string): Promise<FastifyInstance> {
  const app = await buildTestApp(dataDir)
  apps.push(app)
  return app
}

async function login(target: FastifyInstance, password: string) {
  const response = await target.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: ADMIN, password },
  })
  return { response, cookie: cookieLineOf(response) }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('密码流程：默认凭据拦截与改密吊销', () => {
  it('明文默认密码升级为哈希、改密轮换会话、重启后旧密码失效', async () => {
    const dataDir = await makeTempDataDir('dns-pro-password-')
    const configPath = path.join(dataDir, CONFIG_FILE)
    // 模拟旧版本遗留的明文默认密码
    await fs.writeFile(configPath, `${JSON.stringify({ auth: { username: ADMIN, password: ADMIN } }, null, 2)}\n`)
    const app = await startApp(dataDir)

    // 1. 明文默认密码仍可登录，并被标记为默认凭据
    const first = await login(app, ADMIN)
    expect(first.response.statusCode).toBe(200)
    expect(first.response.json().data.is_default_credential).toBe(true)

    // 2. 默认凭据下业务接口被拦截，仅改密码接口放行
    const blocked = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: first.cookie } })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().code).toBe('password_change_required')

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: first.cookie },
      payload: { current_password: 'wrong-password', new_password: NEW_PASSWORD },
    })
    // 改密码接口必须放行：凭据校验失败返回 401 而非 403
    expect(allowed.statusCode, '改密码接口必须放行（凭据校验失败返回 401 而非 403）').toBe(401)

    // 3. 未登录不得改密码（鉴权在路由级限流之前拒绝，因此这一步不消耗改密码接口的限流额度）
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { current_password: ADMIN, new_password: NEW_PASSWORD },
    })
    expect(anonymous.statusCode).toBe(401)

    // 4. 弱密码被拒
    for (const weak of ['short', ADMIN, 'admin123']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: { cookie: first.cookie },
        payload: { current_password: ADMIN, new_password: weak },
      })
      expect(res.statusCode, `弱密码 ${weak} 必须被拒绝`).toBe(422)
    }

    // 5. 另一台设备在改密码前的会话，改密码后必须失效
    const other = await login(app, ADMIN)
    expect(other.response.statusCode).toBe(200)

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: first.cookie },
      payload: { current_password: ADMIN, new_password: NEW_PASSWORD },
    })
    expect(changed.statusCode, changed.body).toBe(200)
    expect(changed.json().data.authenticated).toBe(true)
    expect(changed.json().data.is_default_credential).toBe(false)

    // 6. 改密码会轮换 Cookie：新 Cookie（浏览器自动保存）保持登录，旧 Cookie 立即失效
    const rotatedCookie = cookieLineOf(changed)
    expect(rotatedCookie, '改密码必须为当前设备重新签发 Cookie').not.toBe('')
    expect(rotatedCookie).not.toBe(first.cookie)

    const staleDevice = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: first.cookie } })
    expect(staleDevice.statusCode, '改密码前的旧 Cookie 必须失效').toBe(401)
    const afterChange = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: rotatedCookie } })
    expect(afterChange.statusCode, '改密码后当前设备应保持登录').toBe(200)
    const otherAfter = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: other.cookie } })
    expect(otherAfter.statusCode, '改密码必须吊销其他设备会话').toBe(401)

    // 7. 落盘只有哈希，明文被清除
    const stored = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
      auth: { password?: unknown; password_hash?: unknown }
    }
    expect(stored.auth.password, '明文密码必须被移除').toBeUndefined()
    expect(String(stored.auth.password_hash), '必须落盘 scrypt 哈希').toMatch(DEFAULT_HASH)
    // Windows 无 POSIX 权限位，权限断言只在 POSIX 平台生效
    if (process.platform !== 'win32') expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600)

    // 8. 重启后：新密码可登录，旧默认密码失效
    const restarted = await startApp(dataDir)
    expect(restarted.ctx.initialPassword, '已有配置时不得生成新的初始密码').toBeNull()
    expect((await login(restarted, NEW_PASSWORD)).response.statusCode).toBe(200)
    expect((await login(restarted, ADMIN)).response.statusCode, '旧默认密码必须失效').toBe(401)
    const session = await restarted.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: ADMIN, password: NEW_PASSWORD },
    })
    expect(session.json().data.is_default_credential).toBe(false)
    // 改密与重启复验要跑多次 scrypt；全量并行执行时默认 5s 超时不够
  }, 30_000)

  it('首启生成随机初始密码：只落盘哈希，随机密码可登录且不算默认凭据', async () => {
    const dataDir = await makeTempDataDir('dns-pro-password-first-boot-')
    const app = await startApp(dataDir)

    const initialPassword = app.ctx.initialPassword
    expect(initialPassword).toEqual(expect.any(String))
    const password = String(initialPassword)
    expect(password).toHaveLength(16)

    const stored = JSON.parse(await fs.readFile(path.join(dataDir, CONFIG_FILE), 'utf8')) as {
      auth?: { password?: unknown; password_hash?: unknown }
    }
    expect(stored.auth?.password, '初始密码不得以明文落盘').toBeUndefined()
    expect(String(stored.auth?.password_hash)).toMatch(DEFAULT_HASH)

    const first = await login(app, password)
    expect(first.response.statusCode).toBe(200)
    expect(first.response.json().data.is_default_credential).toBe(false)

    // 随机初始密码不是默认凭据，业务接口直接放行
    const providers = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: first.cookie } })
    expect(providers.statusCode).toBe(200)
  })
})
