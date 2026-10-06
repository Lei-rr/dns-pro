import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from './config.js'
import { buildApp } from './lifecycle.js'

/**
 * 安全/密码类测试的装配桩（原 scripts/isolated-*-probe 开头那段配置）。
 * 多个测试文件共用同一份 AppConfig 默认值，避免「临时目录 + 关闭日志 + 不信任代理 + Cookie 不要求 Secure」
 * 这组装配参数在各处各写一遍后漂移。
 */

/** 会话 Cookie 名：伪造/篡改 token 的断言按名字拼 Cookie 头 */
export const TEST_SESSION_COOKIE_NAME = 'test_session'

/** 固定会话密钥：会话失效只应受会话代次与凭据影响，不引入密钥文件这一变量 */
const TEST_SESSION_SECRET = 'test-session-secret-with-more-than-32-characters'

/**
 * 数据目录一律用 `dns-pro-` 前缀：整轮测试结束后由 vitest.global-setup.ts 按运行前后快照清理本轮新建的目录。
 * 用例内不清理，失败现场得以保留到本轮结束（需要跨轮保留设 KEEP_TMP=1）。
 */
export function makeTempDataDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

export function testAppConfig(dataDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    sessionSecret: TEST_SESSION_SECRET,
    sessionCookieName: TEST_SESSION_COOKIE_NAME,
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    httpTimeoutMs: 1000,
    ...overrides,
  }
}

export async function buildTestApp(dataDir: string, overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const app = await buildApp(testAppConfig(dataDir, overrides))
  await app.ready()
  return app
}

/** 取 Set-Cookie 的「名=值」段；响应带多个 Cookie 时取第一个（与探针一致） */
export function cookieLineOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie']
  const line = Array.isArray(raw) ? raw[0] : raw
  if (line === undefined || line === null) return ''
  return String(line).split(';', 1)[0] ?? ''
}
