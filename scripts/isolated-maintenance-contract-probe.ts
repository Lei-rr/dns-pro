#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const root = new URL('../', import.meta.url)
const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8')

// 部署契约：镜像内没有 curl/wget，健康检查必须用 node 请求 /api/health
assert.match(dockerfile, /^HEALTHCHECK\s/m)
assert.match(dockerfile, /node[\s\S]*\/api\/health/)
assert.doesNotMatch(dockerfile, /HEALTHCHECK[\s\S]{0,300}\b(curl|wget)\b/)

function audit(registry?: string) {
  return spawnSync('npm', ['audit', '--json', ...(registry === undefined ? [] : [`--registry=${registry}`])], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: true, // Windows 上 npm 是 npm.cmd，spawnSync 不经 shell 会 ENOENT
  })
}

/** 漏洞总数；审计端点不可用时返回 null（镜像源未实现 security API / 离线） */
function vulnerabilityTotal(run: ReturnType<typeof audit>): number | null {
  try {
    const report = JSON.parse(String(run.stdout || '{}')) as {
      metadata?: { vulnerabilities?: { total?: number } }
    }
    return typeof report.metadata?.vulnerabilities?.total === 'number' ? report.metadata.vulnerabilities.total : null
  } catch {
    return null
  }
}

// 本机 registry 常配成 npmmirror 这类不实现 security advisories 的镜像（404），
// 拿不到数据既不能当「零漏洞」也不能当仓库缺陷：换官方源复审一次，两处都不可用才算环境故障
const configured = audit()
const verified = vulnerabilityTotal(configured) === null ? audit('https://registry.npmjs.org') : configured
const total = vulnerabilityTotal(verified)
assert.notEqual(total, null, `npm audit 端点不可用：${String(configured.stderr || configured.stdout).slice(0, 300)}`)
assert.equal(total, 0, 'all dependency vulnerabilities must be zero')
assert.equal(verified.status, 0, verified.stderr || verified.stdout)

console.log('maintenance-contract-probe=ok audit=0 healthcheck=node')
