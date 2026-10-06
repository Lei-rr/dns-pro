import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from './lifecycle.js'

/**
 * 迁移自 scripts/isolated-static-probe.ts：静态资源引用与 SPA history 回退。
 *
 * 构建产物（web/dist）在版本库外，而 CI 的 npm test 早于 build：真实产物存在时按其断言，
 * 同时用一份最小 dist fixture 跑同一条装配与断言路径，保证任何环境都覆盖到（含未构建的 CI）。
 */

const repoWebDist = fileURLToPath(new URL('../../web/dist/', import.meta.url))
const hasBuiltDist = await fs
  .access(path.join(repoWebDist, 'index.html'))
  .then(() => true)
  .catch(() => false)

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** 最小 dist fixture：一份外壳 + 两条 /assets/ 引用，结构与构建产物一致 */
async function createFixtureDist(): Promise<string> {
  const dir = await tempDir('dns-static-dist-')
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  await fs.writeFile(path.join(dir, 'assets', 'app.js'), 'console.log("fixture")\n')
  await fs.writeFile(path.join(dir, 'assets', 'app.css'), 'body{}\n')
  await fs.writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><script type="module" src="/assets/app.js"></script>' +
      '<link rel="stylesheet" href="/assets/app.css"></head><body><div id="app"></div></body></html>\n'
  )
  return dir
}

async function runStaticContract(distDir: string): Promise<void> {
  const dataDir = await tempDir('dns-static-files-')
  await fs.writeFile(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ auth: { username: 'probe', password: 'probe' } })
  )
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ items: [] }))

  const app = await buildApp({
    host: '127.0.0.1',
    port: 0,
    logLevel: false,
    dataDir,
    webDistDir: distDir,
    sessionSecret: 'static-files-test-session-secret-longer-than-thirty-two-characters',
    sessionCookieName: 'dns_static_test',
    sessionMaxAgeSeconds: 3600,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: false,
    httpTimeoutMs: 1000,
  })
  try {
    const root = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } })
    expect(root.statusCode).toBe(200)
    expect(String(root.headers['content-type'])).toMatch(/^text\/html/)
    expect(String(root.headers['cache-control'])).toMatch(/no-store/)

    const references = [...root.body.matchAll(/(?:src|href)="(\/[^"?#]+)["?#]/g)].map((match) => match[1] ?? '')
    expect(references.length).toBeGreaterThan(0)
    for (const reference of references) {
      const response = await app.inject({ method: 'GET', url: reference })
      expect(response.statusCode, reference).toBe(200)
      // 外壳引用的资源不得被 SPA 回退成 index.html
      expect(String(response.headers['content-type']), reference).not.toMatch(/^text\/html/)
    }

    const asset = references.find((reference) => reference.startsWith('/assets/'))
    expect(asset).toBeTruthy()
    const assetResponse = await app.inject({ method: 'GET', url: String(asset) })
    expect(String(assetResponse.headers['cache-control'])).toMatch(/immutable/)

    const missingAsset = await app.inject({ method: 'GET', url: '/assets/definitely-missing.js' })
    expect(missingAsset.statusCode).toBe(404)
    expect(String(missingAsset.headers['content-type'])).toMatch(/^application\/json/)

    const deepLink = await app.inject({ method: 'GET', url: '/providers/deep-link', headers: { accept: 'text/html' } })
    expect(deepLink.statusCode).toBe(200)
    expect(String(deepLink.headers['content-type'])).toMatch(/^text\/html/)

    const apiMissing = await app.inject({ method: 'GET', url: '/api/definitely-missing' })
    expect(apiMissing.statusCode).toBe(404)
    expect(apiMissing.json().code).toBe('not_found')
  } finally {
    await app.close()
  }
}

describe('静态资源与 SPA 回退', () => {
  it.skipIf(!hasBuiltDist)('真实 web/dist 产物：引用可达、assets 不可变缓存、深链回退', async () => {
    await runStaticContract(repoWebDist)
  })

  it('最小 dist fixture：同一条装配与断言路径（覆盖未构建的环境）', async () => {
    await runStaticContract(await createFixtureDist())
  })
})
