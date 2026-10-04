#!/usr/bin/env node
// 密码存储与强制改密：首启随机密码、默认凭据拦截、改密码后的会话与凭据状态
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app/build.js'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-password-'))
const configPath = path.join(dataDir, 'config.json')
// 模拟旧版本遗留的明文默认密码
await fs.writeFile(configPath, `${JSON.stringify({ auth: { username: 'admin', password: 'admin' } }, null, 2)}\n`)

const base = {
  host: '127.0.0.1',
  port: 0,
  logLevel: false as const,
  dataDir,
  sessionSecret: 'password-probe-secret-longer-than-thirty-two-characters',
  sessionCookieName: 'password_probe',
  sessionMaxAgeSeconds: 3600,
  cookieSecure: false,
  cookieSameSite: 'lax' as const,
  trustProxy: false,
  httpTimeoutMs: 1000,
}

const login = async (app: Awaited<ReturnType<typeof buildApp>>, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { username: 'admin', password } })
  const raw = res.headers['set-cookie']
  const line = Array.isArray(raw) ? raw[0] : raw
  return { res, cookie: line ? String(line).split(';', 1)[0] : '' }
}

const app = await buildApp(base)
try {
  await app.ready()

  // 1. 明文默认密码仍可登录，并被标记为默认凭据
  const first = await login(app, 'admin')
  assert.equal(first.res.statusCode, 200)
  assert.equal(first.res.json().data.is_default_credential, true)

  // 2. 默认凭据下业务接口被拦截，仅改密码接口放行
  const blocked = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: first.cookie } })
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json().code, 'password_change_required')
  const allowed = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie: first.cookie },
    payload: { current_password: 'wrong-password', new_password: 'brand-new-password' },
  })
  assert.equal(allowed.statusCode, 401, '改密码接口必须放行（凭据校验失败返回 401 而非 403）')

  // 3. 未登录不得改密码
  const anonymous = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    payload: { current_password: 'admin', new_password: 'brand-new-password' },
  })
  assert.equal(anonymous.statusCode, 401)

  // 4. 弱密码被拒
  for (const weak of ['short', 'admin', 'admin123']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: first.cookie },
      payload: { current_password: 'admin', new_password: weak },
    })
    assert.equal(res.statusCode, 422, `弱密码 ${weak} 必须被拒绝`)
  }

  // 5. 另一台设备在改密码前的会话，改密码后必须失效
  const other = await login(app, 'admin')
  assert.equal(other.res.statusCode, 200)

  const changed = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie: first.cookie },
    payload: { current_password: 'admin', new_password: 'brand-new-password' },
  })
  assert.equal(changed.statusCode, 200, changed.body)
  assert.equal(changed.json().data.authenticated, true)
  assert.equal(changed.json().data.is_default_credential, false)

  // 6. 改密码会轮换 Cookie：新 Cookie（浏览器自动保存）保持登录，旧 Cookie 立即失效
  const rotatedRaw = changed.headers['set-cookie']
  const rotatedLine = Array.isArray(rotatedRaw) ? rotatedRaw[0] : rotatedRaw
  const rotatedCookie = rotatedLine ? String(rotatedLine).split(';', 1)[0] : ''
  assert.ok(rotatedCookie, '改密码必须为当前设备重新签发 Cookie')
  assert.notEqual(rotatedCookie, first.cookie)
  const staleDevice = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: first.cookie } })
  assert.equal(staleDevice.statusCode, 401, '改密码前的旧 Cookie 必须失效')
  const afterChange = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: rotatedCookie } })
  assert.equal(afterChange.statusCode, 200, '改密码后当前设备应保持登录')
  const otherAfter = await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie: other.cookie } })
  assert.equal(otherAfter.statusCode, 401, '改密码必须吊销其他设备会话')

  // 7. 落盘只有哈希，明文被清除
  const stored = JSON.parse(await fs.readFile(configPath, 'utf8'))
  assert.equal(stored.auth.password, undefined, '明文密码必须被移除')
  assert.ok(String(stored.auth.password_hash).startsWith('scrypt$'), '必须落盘 scrypt 哈希')
  // Windows 无 POSIX 权限位，权限断言只在 POSIX 平台生效
  if (process.platform !== 'win32') assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600)
} finally {
  await app.close()
}

// 8. 重启后：新密码可登录，旧默认密码失效
const restarted = await buildApp(base)
try {
  await restarted.ready()
  assert.equal(restarted.ctx.initialPassword, null, '已有配置时不得生成新的初始密码')
  assert.equal((await login(restarted, 'brand-new-password')).res.statusCode, 200)
  assert.equal((await login(restarted, 'admin')).res.statusCode, 401, '旧默认密码必须失效')
  const session = await restarted.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'admin', password: 'brand-new-password' },
  })
  assert.equal(session.json().data.is_default_credential, false)
} finally {
  await restarted.close()
  await fs.rm(dataDir, { recursive: true, force: true })
}

console.log('password-probe=ok scrypt=stored default=blocked change=revokes')
