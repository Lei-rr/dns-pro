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

const audit = spawnSync('npm', ['audit', '--json'], {
  cwd: new URL('../', import.meta.url),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  shell: true, // Windows 上 npm 是 npm.cmd，spawnSync 不经 shell 会 ENOENT
})
const report = JSON.parse(audit.stdout || '{}')
assert.equal(report.metadata?.vulnerabilities?.total, 0, 'all dependency vulnerabilities must be zero')
assert.equal(audit.status, 0, audit.stderr || audit.stdout)

console.log('maintenance-contract-probe=ok audit=0 healthcheck=node')
