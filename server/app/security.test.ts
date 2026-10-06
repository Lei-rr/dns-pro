import fs from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CloudflareClient } from '../modules/cloudflare/cloudflare.client.js'
import { buildTestApp, cookieLineOf, makeTempDataDir, TEST_SESSION_COOKIE_NAME } from './test-helpers.js'

/**
 * 安全回归（迁移自 scripts/isolated-security-probe.ts）：
 * 会话吊销 / CSRF（Origin 校验）/ 上游路径注入 / 错误信息脱敏 / 暴力破解锁定。
 *
 * 每个 it 用独立数据目录、独立 app 实例，避免探针里进程级的失败计数与会话代次在用例间串味；
 * 用例内部需要状态流转的步骤（如 CSRF 被拒后会话仍有效）仍按原顺序在同一 it 内执行。
 */

const CONFIG_FILE = 'config.json'

const apps: FastifyInstance[] = []
let dataDir = ''

const configPath = () => path.join(dataDir, CONFIG_FILE)

/** 创建并登记实例，afterEach 统一关闭（原探针的 finally app.close()） */
async function startApp(): Promise<FastifyInstance> {
  const app = await buildTestApp(dataDir)
  apps.push(app)
  return app
}

/** 预置账号：明文密码在启动时被升级为 scrypt 哈希，后续直接用该密码登录 */
async function seedCredentials(password: string): Promise<void> {
  await fs.writeFile(configPath(), `${JSON.stringify({ auth: { username: 'owner', password } })}\n`)
}

async function login(app: FastifyInstance, password: string, remoteAddress = '10.0.0.1') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'owner', password },
    remoteAddress,
  })
  return { response, cookie: cookieLineOf(response) }
}

async function authenticatedStatus(app: FastifyInstance, cookie: string): Promise<number> {
  return (await app.inject({ method: 'GET', url: '/api/providers', headers: { cookie } })).statusCode
}

beforeEach(async () => {
  dataDir = await makeTempDataDir('dns-pro-security-')
})

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('安全回归：会话 / CSRF / 上游路径 / 信息泄露 / 暴力破解', () => {
  it('匿名请求只返回最小信息，数据接口一律先过鉴权', async () => {
    await seedCredentials('first-password')
    const app = await startApp()

    // 匿名健康检查不泄露版本与内部统计
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json().data).toEqual({ status: 'ok' })

    const anonymousSession = await app.inject({ method: 'GET', url: '/api/session' })
    expect(anonymousSession.json().data.version).toBeUndefined()

    // 新增数据接口（解析线路）同样必须在鉴权范围内
    const anonymousLines = await app.inject({
      method: 'GET',
      url: '/api/dnspod/providers/p/zones/example.com/lines',
    })
    expect(anonymousLines.statusCode, '未登录不得读取线路列表').toBe(401)

    // 未登录应先被鉴权拦截，不得进入业务错误分支
    const englishLeak = await app.inject({ method: 'GET', url: '/api/providers/missing-provider' })
    expect(englishLeak.statusCode, '未登录应先被鉴权拦截').toBe(401)
  })

  it('登录 Cookie 为 HttpOnly + SameSite=Lax，篡改与伪造 token 无效', async () => {
    await seedCredentials('first-password')
    const app = await startApp()

    const first = await login(app, 'first-password')
    expect(first.response.statusCode).toBe(200)
    const setCookie = String(first.response.headers['set-cookie'])
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(await authenticatedStatus(app, first.cookie)).toBe(200)

    // 篡改 / 伪造 token 无效
    const tampered = first.cookie.slice(0, -2) + (first.cookie.endsWith('AA') ? 'BB' : 'AA')
    expect(await authenticatedStatus(app, tampered)).toBe(401)
    expect(await authenticatedStatus(app, `${TEST_SESSION_COOKIE_NAME}=v2.a.b.c`)).toBe(401)
  })

  it('已映射的错误码回中文：内部英文文本不直接暴露', async () => {
    await seedCredentials('first-password')
    const app = await startApp()
    const first = await login(app, 'first-password')

    const missingProvider = await app.inject({
      method: 'GET',
      url: '/api/providers/missing-provider',
      headers: { cookie: first.cookie },
    })
    expect(missingProvider.statusCode).toBe(404)
    expect(missingProvider.json().code).toBe('provider_not_found')
    expect(String(missingProvider.json().message), '错误提示必须是中文').toMatch(/[\u4e00-\u9fff]/)
  })

  it('CSRF：跨站写请求 403，代理改写的同源写请求放行，缺少同源声明不放行', async () => {
    await seedCredentials('first-password')
    const app = await startApp()
    const first = await login(app, 'first-password')

    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/providers',
      headers: { cookie: first.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      payload: { id: 'x', type: 'dnspod' },
    })
    expect(crossSite.statusCode).toBe(403)
    expect(crossSite.json().code).toBe('csrf_rejected')

    const foreignOrigin = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { cookie: first.cookie, origin: 'https://evil.example' },
    })
    expect(foreignOrigin.statusCode).toBe(403)
    expect(await authenticatedStatus(app, first.cookie), 'rejected CSRF logout must not revoke the session').toBe(200)

    // 开发代理（vite changeOrigin）：Host 被改写成后端地址，Origin 仍是前端地址。
    // 浏览器对写请求必带 Origin，此时只有 sec-fetch-site: same-origin 能证明同源，必须放行，
    // 否则 README 记载的 5173 + 3022 开发流程下登录与全部写请求都会被误判成跨站（403 csrf_rejected）
    const proxiedWrite = await app.inject({
      method: 'POST',
      url: '/api/providers',
      headers: {
        cookie: first.cookie,
        origin: 'http://127.0.0.1:5173',
        host: '127.0.0.1:3022',
        'sec-fetch-site': 'same-origin',
      },
      payload: { id: 'proxied', type: 'dnspod', secret_id: 'proxied-id', secret_key: 'proxied-key' },
    })
    expect(
      [200, 201],
      `Host 被代理改写时同源写请求必须放行，实际 ${proxiedWrite.statusCode}: ${proxiedWrite.body}`
    ).toContain(proxiedWrite.statusCode)

    // 没有浏览器同源声明时不得放宽：Origin 与 Host 不一致仍按跨站拒绝
    const spoofedHost = await app.inject({
      method: 'POST',
      url: '/api/providers',
      headers: { cookie: first.cookie, origin: 'http://127.0.0.1:5173', host: '127.0.0.1:3022' },
      payload: { id: 'spoofed', type: 'dnspod', secret_id: 'spoofed-id', secret_key: 'spoofed-key' },
    })
    expect(spoofedHost.statusCode, '缺少同源声明时不得只凭 Origin/Host 不一致放行').toBe(403)
    expect(spoofedHost.json().code).toBe('csrf_rejected')
  })

  it('上游路径注入：非法记录 ID 不会产生任何上游删除请求', async () => {
    await seedCredentials('first-password')
    const app = await startApp()
    const first = await login(app, 'first-password')

    const created = await app.inject({
      method: 'POST',
      url: '/api/providers',
      headers: { cookie: first.cookie },
      payload: { id: 'cf', type: 'cloudflare', api_token: 'token', account_id: 'acct' },
    })
    expect(created.statusCode).toBe(201)

    // 桩掉上游客户端，记录所有出站调用：判断标准不是响应码，而是上游到底有没有收到 DELETE
    const upstreamCalls: string[] = []
    const originalGet = CloudflareClient.prototype.get
    const originalDelete = CloudflareClient.prototype.delete
    try {
      CloudflareClient.prototype.get = async (p: string) => {
        upstreamCalls.push(`GET ${p}`)
        return {
          success: true,
          result: [{ id: 'zone-1', name: 'example.com' }],
          result_info: { total_pages: 1 },
        }
      }
      CloudflareClient.prototype.delete = async (p: string) => {
        upstreamCalls.push(`DELETE ${p}`)
        return { success: true, result: { id: 'x' } }
      }

      // 记录 ID 为 .. / . / %2e%2e / a/b / ../zones 时必须被 schema 拒绝
      for (const id of ['..', '.', '%2e%2e', 'a/b', '../zones']) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/cloudflare/providers/cf/zones/example.com/records/batch-delete',
          headers: { cookie: first.cookie },
          payload: { records: [{ id }] },
        })
        expect(res.statusCode, `record id ${id} must be rejected by schema`).toBe(400)
      }

      for (const url of [
        '/api/cloudflare/providers/cf/zones/example.com/records/..',
        '/api/cloudflare/providers/cf/zones/example.com/records/%2E%2E',
        '/api/cloudflare/providers/cf/zones/..%2Fexample.com/records/1',
      ]) {
        const res = await app.inject({ method: 'DELETE', url, headers: { cookie: first.cookie } })
        expect([400, 404], `${url} must be rejected`).toContain(res.statusCode)
      }
    } finally {
      CloudflareClient.prototype.get = originalGet
      CloudflareClient.prototype.delete = originalDelete
    }

    expect(
      upstreamCalls.filter((call) => call.startsWith('DELETE')),
      `unexpected upstream delete: ${upstreamCalls}`
    ).toEqual([])
  })

  it('错误响应不泄露数据目录路径与上游原始响应', async () => {
    await seedCredentials('first-password')
    const app = await startApp()
    const first = await login(app, 'first-password')

    const providerError = await app.inject({
      method: 'GET',
      url: '/api/cloudflare/providers/missing/zones',
      headers: { cookie: first.cookie },
    })
    expect(providerError.statusCode).toBe(404)
    expect(providerError.body).not.toMatch(new RegExp(dataDir.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    expect(providerError.body).not.toMatch(/upstream_body|original_error/)
  })

  it('登出吊销所有设备上的会话', async () => {
    await seedCredentials('first-password')
    const app = await startApp()

    const first = await login(app, 'first-password', '10.0.0.1')
    const second = await login(app, 'first-password', '10.0.0.2')
    expect(await authenticatedStatus(app, second.cookie)).toBe(200)

    const logout = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: first.cookie } })
    expect(logout.statusCode).toBe(204)
    expect(await authenticatedStatus(app, first.cookie), 'logged-out token still valid').toBe(401)
    expect(await authenticatedStatus(app, second.cookie), 'logout must revoke other sessions').toBe(401)
  })

  it('外部改写密码后旧会话立即失效', async () => {
    await seedCredentials('first-password')
    const app = await startApp()

    const beforeChange = await login(app, 'first-password', '10.0.0.3')
    expect(await authenticatedStatus(app, beforeChange.cookie)).toBe(200)

    const stored = JSON.parse(await fs.readFile(configPath(), 'utf8')) as { session_epoch?: unknown }
    await fs.writeFile(
      configPath(),
      `${JSON.stringify({ auth: { username: 'owner', password: 'second-password' }, session_epoch: stored.session_epoch })}\n`
    )
    expect(await authenticatedStatus(app, beforeChange.cookie), 'password change must revoke sessions').toBe(401)
    expect((await login(app, 'second-password', '10.0.0.4')).response.statusCode).toBe(200)
  })

  it('同一来源连续失败：前 5 次 401，第 6 次触发限流；其它来源不受影响', async () => {
    await seedCredentials('first-password')
    const app = await startApp()

    const attacker = '172.16.0.1'
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await login(app, 'wrong-password', attacker)).response.statusCode, `第 ${attempt} 次失败应为 401`).toBe(
        401
      )
    }
    expect((await login(app, 'first-password', attacker)).response.statusCode, '同一来源连续失败必须被限流').toBe(429)

    // 被拦的只是攻击来源：管理员从其它 IP 仍可登录（否则任意来源都能锁死管理员）
    expect(
      (await login(app, 'first-password', '10.1.1.1')).response.statusCode,
      '其它来源不应被攻击者的失败计数影响'
    ).toBe(200)
    // 连续失败要跑满 10+ 次 scrypt 校验，全量并行执行时默认 5s 超时不够
  }, 30_000)

  it('轮换来源的分布式猜测最终被全局兜底拦截', async () => {
    await seedCredentials('first-password')
    const app = await startApp()

    // 每个来源地址只试一次（与探针相同的地址生成方式），绕过按 IP 的锁定与限流计数
    let globallyLocked = false
    for (let ip = 0; ip < 12 && !globallyLocked; ip++) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await login(app, 'wrong-password', `172.20.${ip}.${attempt}`)
        if (res.response.statusCode === 429) {
          globallyLocked = true
          break
        }
        expect(res.response.statusCode).toBe(401)
      }
    }
    expect(globallyLocked, '轮换 IP 的分布式猜测最终必须被全局兜底拦截').toBe(true)
    // 50 次失败登录全是 scrypt 校验；全量并行执行时默认 5s 超时不够
  }, 30_000)
})
