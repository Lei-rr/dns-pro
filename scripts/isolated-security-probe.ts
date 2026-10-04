#!/usr/bin/env node
// 安全回归探针：会话吊销 / CSRF / 上游路径注入 / 信息泄露 / 暴力破解
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../server/src/app.js'
import { CloudflareClient } from '../server/src/modules/cloudflare/cloudflare.client.js'
import { setDataRoot } from '../server/src/platform/storage/json-store.js'

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-security-'))
const configPath = path.join(dataDir, 'config.json')
const writeCredentials = (password: string) =>
  fs.writeFile(configPath, `${JSON.stringify({ auth: { username: 'owner', password } })}\n`)
await writeCredentials('first-password')
setDataRoot(dataDir)

const app = await buildApp({
  host: '127.0.0.1',
  port: 0,
  logLevel: false,
  dataDir,
  sessionSecret: 'security-probe-secret-with-more-than-32-chars',
  sessionCookieName: 'sec_probe',
  sessionMaxAgeSeconds: 3600,
  cookieSecure: false,
  cookieSameSite: 'lax',
  trustProxy: false,
  httpTimeoutMs: 1000,
})

async function login(password: string, remoteAddress = '10.0.0.1') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'owner', password },
    remoteAddress,
  })
  const raw = res.headers['set-cookie']
  const line = Array.isArray(raw) ? raw[0] : raw
  return { res, cookie: line ? String(line).split(';', 1)[0] : '' }
}
const authed = async (cookie: string) =>
  (await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie } })).statusCode

try {
  await app.ready()

  // 1. 匿名健康检查不泄露版本与内部统计
  const health = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.json().data, { status: 'ok' })
  assert.equal((await app.inject({ method: 'GET', url: '/api/session' })).json().data.version, undefined)

  // 新增数据接口（解析线路）同样必须在鉴权范围内
  const anonymousLines = await app.inject({
    method: 'GET',
    url: '/api/dnspod/providers/p/zones/example.com/lines',
  })
  assert.equal(anonymousLines.statusCode, 401, '未登录不得读取线路列表')

  // 已映射的错误码必须回中文：内部英文文本不能直接暴露给用户
  const englishLeak = await app.inject({
    method: 'GET',
    url: '/api/providers/missing-provider',
    headers: { cookie: '' },
  })
  assert.equal(englishLeak.statusCode, 401, '未登录应先被鉴权拦截')

  // 2. Cookie 属性
  const first = await login('first-password')
  assert.equal(first.res.statusCode, 200)
  const setCookie = String(first.res.headers['set-cookie'])
  assert.match(setCookie, /HttpOnly/i)
  assert.match(setCookie, /SameSite=Lax/i)
  assert.equal(await authed(first.cookie), 200)

  // 未登录之外的已映射错误码：中文提示（内部英文文本不外泄）
  const missingProvider = await app.inject({
    method: 'GET',
    url: '/api/providers/missing-provider',
    headers: { cookie: first.cookie },
  })
  assert.equal(missingProvider.statusCode, 404)
  assert.equal(missingProvider.json().code, 'provider_not_found')
  assert.match(String(missingProvider.json().message), /[\u4e00-\u9fff]/, '错误提示必须是中文')

  // 3. 篡改 / 伪造 token 无效
  const tampered = first.cookie.slice(0, -2) + (first.cookie.endsWith('AA') ? 'BB' : 'AA')
  assert.equal(await authed(tampered), 401)
  assert.equal(await authed('sec_probe=v2.a.b.c'), 401)

  // 4. CSRF：跨站写请求拒绝，同源放行
  const crossSite = await app.inject({
    method: 'POST',
    url: '/api/providers',
    headers: { cookie: first.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    payload: { id: 'x', type: 'dnspod' },
  })
  assert.equal(crossSite.statusCode, 403)
  assert.equal(crossSite.json().code, 'csrf_rejected')
  const foreignOrigin = await app.inject({
    method: 'DELETE',
    url: '/api/session',
    headers: { cookie: first.cookie, origin: 'https://evil.example' },
  })
  assert.equal(foreignOrigin.statusCode, 403)
  assert.equal(await authed(first.cookie), 200, 'rejected CSRF logout must not revoke the session')

  // 5. 上游路径注入：记录 ID 为 .. 时绝不能发出「删除站点」请求
  await app.inject({
    method: 'POST',
    url: '/api/providers',
    headers: { cookie: first.cookie },
    payload: { id: 'cf', type: 'cloudflare', api_token: 'token', account_id: 'acct' },
  })
  const upstreamCalls: string[] = []
  const originalGet = CloudflareClient.prototype.get
  const originalDelete = CloudflareClient.prototype.delete
  CloudflareClient.prototype.get = async function (p: string) {
    upstreamCalls.push(`GET ${p}`)
    return { success: true, result: [{ id: 'zone-1', name: 'example.com' }], result_info: { total_pages: 1 } }
  }
  CloudflareClient.prototype.delete = async function (p: string) {
    upstreamCalls.push(`DELETE ${p}`)
    return { success: true, result: { id: 'x' } }
  }
  for (const id of ['..', '.', '%2e%2e', 'a/b', '../zones']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/providers/cf/zones/example.com/records/batch-delete',
      headers: { cookie: first.cookie },
      payload: { records: [{ id }] },
    })
    assert.equal(res.statusCode, 400, `record id ${id} must be rejected by schema`)
  }
  for (const url of [
    '/api/cloudflare/providers/cf/zones/example.com/records/..',
    '/api/cloudflare/providers/cf/zones/example.com/records/%2E%2E',
    '/api/cloudflare/providers/cf/zones/..%2Fexample.com/records/1',
  ]) {
    const res = await app.inject({ method: 'DELETE', url, headers: { cookie: first.cookie } })
    assert.ok([400, 404].includes(res.statusCode), `${url} must be rejected`)
  }
  CloudflareClient.prototype.get = originalGet
  CloudflareClient.prototype.delete = originalDelete
  assert.ok(!upstreamCalls.some((call) => call.startsWith('DELETE')), `unexpected upstream delete: ${upstreamCalls}`)

  // 6. 错误响应不泄露上游原始响应 / 文件路径
  const providerError = await app.inject({
    method: 'GET',
    url: '/api/cloudflare/providers/missing/zones',
    headers: { cookie: first.cookie },
  })
  assert.equal(providerError.statusCode, 404)
  assert.doesNotMatch(providerError.body, new RegExp(dataDir.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(providerError.body, /upstream_body|original_error/)

  // 7. 登出吊销所有设备上的会话
  const second = await login('first-password', '10.0.0.2')
  assert.equal(await authed(second.cookie), 200)
  const logout = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: first.cookie } })
  assert.equal(logout.statusCode, 204)
  assert.equal(await authed(first.cookie), 401, 'logged-out token still valid')
  assert.equal(await authed(second.cookie), 401, 'logout must revoke other sessions')

  // 8. 修改密码后旧会话立即失效
  const beforeChange = await login('first-password', '10.0.0.3')
  assert.equal(await authed(beforeChange.cookie), 200)
  const epoch = JSON.parse(await fs.readFile(configPath, 'utf8')).session_epoch
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ auth: { username: 'owner', password: 'second-password' }, session_epoch: epoch })}\n`
  )
  assert.equal(await authed(beforeChange.cookie), 401, 'password change must revoke sessions')
  assert.equal((await login('second-password', '10.0.0.4')).res.statusCode, 200)

  // 9. 同一来源连续失败：前 5 次 401，第 6 次触发限流
  const attacker = '172.16.0.1'
  for (let i = 0; i < 5; i++) {
    const res = await login('wrong-password', attacker)
    assert.equal(res.res.statusCode, 401, `第 ${i + 1} 次失败应为 401`)
  }
  assert.equal((await login('second-password', attacker)).res.statusCode, 429, '同一来源连续失败必须被限流')

  // 10. 被拦的只是攻击来源：管理员从其它 IP 仍可登录（否则任意来源都能锁死管理员）
  assert.equal((await login('second-password', '10.1.1.1')).res.statusCode, 200, '其它来源不应被攻击者的失败计数影响')

  // 11. 全局兜底：轮换 IP（每 IP 5 次）累计失败后，全新 IP 也会被拦
  let globalLocked = false
  for (let ip = 0; ip < 12 && !globalLocked; ip++) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await login('wrong-password', `172.20.${ip}.${attempt}`)
      if (res.res.statusCode === 429) {
        globalLocked = true
        break
      }
      assert.equal(res.res.statusCode, 401)
    }
  }
  assert.ok(globalLocked, '轮换 IP 的分布式猜测最终必须被全局兜底拦截')

  console.log(
    'security-probe=ok session=revocable csrf=origin upstream-path=guarded errors=sanitized bruteforce=locked'
  )
} finally {
  await app.close()
  await fs.rm(dataDir, { recursive: true, force: true })
}
