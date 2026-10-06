import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './lifecycle.js'
import { DNS_BATCH_DELETE_JOB, EDGEONE_BATCH_DISABLE_JOB } from '../core/jobs/job-registry.js'

/**
 * 批量任务端点的归属隔离（原 scripts/isolated-backend-safe-probe.ts 的 API 段）：
 * 详情与重试都必须按所属服务商与任务族类型校验——不同 providerId、不同 provider_type
 * 一律读不到（详情 data 为 null、重试 404），否则面板能借错误端点探测他人任务的存在性；
 * 非法标识符（tunnel id 含点号）必须在参数校验阶段直接 400。
 */

let app!: Awaited<ReturnType<typeof buildApp>>
let cookie = ''

beforeAll(async () => {
  // 前缀统一为 dns-pro-：整轮测试结束后由 vitest.global-setup.ts 清理本轮新建的临时数据目录
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-pro-routes-'))
  await fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ auth: { username: 'u', password: 'p' } }))
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }))
  app = await buildApp({
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    sessionSecret: 'safe-probe-session-secret-at-least-32-characters',
    sessionCookieName: 'safe_probe',
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    httpTimeoutMs: 1000,
  })
  await app.ready()
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { username: 'u', password: 'p' } })
  const cookies = login.headers['set-cookie']
  // 会话 cookie 是后续每个请求的前提：缺失说明登录没成功，显式失败而不是带着 'undefined' 字符串继续跑
  const sessionCookie = (Array.isArray(cookies) ? cookies.at(-1) : cookies)?.split(';', 1)[0]
  if (!sessionCookie) throw new Error('登录未返回会话 cookie，无法继续执行批量任务归属隔离用例')
  cookie = sessionCookie
}, 60_000)

afterAll(async () => {
  if (app) await app.close()
})

describe('批量任务端点：按服务商归属隔离', () => {
  it('DNS 批量任务对别的 providerId / 别的 provider_type 都不可读、不可重试', async () => {
    const dns = await app.ctx.platform.jobs.createTerminalExclusive(
      DNS_BATCH_DELETE_JOB,
      { provider_type: 'cloudflare', provider_id: 'owner-a', zone: 'example.com' },
      [{ id: 'r', status: 'failed' }],
      undefined,
      { status: 'failed', message: '批量删除完成：成功 0，失败 1，跳过 0', success: 0, failed: 1, skipped: 0 }
    )

    const foreignProvider = await app.inject({
      method: 'GET',
      url: `/api/cloudflare/providers/owner-b/records/batch/${dns.id}`,
      headers: { cookie },
    })
    expect(foreignProvider.statusCode).toBe(200)
    expect(foreignProvider.json().data).toBeNull()

    const foreignRetry = await app.inject({
      method: 'POST',
      url: `/api/cloudflare/providers/owner-b/records/batch/${dns.id}/retry`,
      headers: { cookie },
    })
    expect(foreignRetry.statusCode).toBe(404)

    const wrongType = await app.inject({
      method: 'GET',
      url: `/api/dnspod/providers/owner-a/records/batch/${dns.id}`,
      headers: { cookie },
    })
    expect(wrongType.statusCode).toBe(200)
    expect(wrongType.json().data).toBeNull()

    const wrongTypeRetry = await app.inject({
      method: 'POST',
      url: `/api/dnspod/providers/owner-a/records/batch/${dns.id}/retry`,
      headers: { cookie },
    })
    expect(wrongTypeRetry.statusCode).toBe(404)
  })

  it('EdgeOne 批量任务同样按 provider 隔离', async () => {
    const edge = await app.ctx.platform.jobs.createTerminalExclusive(
      EDGEONE_BATCH_DISABLE_JOB,
      { provider_id: 'owner-a', zone_id: 'zone-1' },
      [{ domain: 'a.example.com', status: 'failed' }],
      undefined,
      { status: 'failed', message: '批量停用完成：成功 0，失败 1，跳过 0', success: 0, failed: 1, skipped: 0 }
    )

    const edgeRead = await app.inject({
      method: 'GET',
      url: `/api/edgeone/providers/owner-b/batch/${edge.id}`,
      headers: { cookie },
    })
    expect(edgeRead.statusCode).toBe(200)
    expect(edgeRead.json().data).toBeNull()

    const edgeRetry = await app.inject({
      method: 'POST',
      url: `/api/edgeone/providers/owner-b/batch/${edge.id}/retry`,
      headers: { cookie },
    })
    expect(edgeRetry.statusCode).toBe(404)
  })

  it('非法 tunnel 标识符在参数校验阶段 400', async () => {
    const invalidTunnel = await app.inject({
      method: 'GET',
      url: '/api/cloudflared/providers/p/tunnels/invalid.id',
      headers: { cookie },
    })
    expect(invalidTunnel.statusCode).toBe(400)
  })
})
