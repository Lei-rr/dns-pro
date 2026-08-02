#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const root = new URL('../', import.meta.url)
const saasApi = await readFile(new URL('web/src/features/saas/api/saas-api.ts', root), 'utf8')
const saasTypes = await readFile(new URL('web/src/features/saas/model/types.ts', root), 'utf8')
const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

assert.equal(packageJson.devDependencies?.tsup, undefined, 'redundant tsup wrapper must be removed')
assert.doesNotMatch(packageJson.scripts?.['build:server'] || '', /\btsup\b/)
assert.match(saasTypes, /export interface SaaSDnsRepairResult\s*\{/)
assert.match(saasApi, /repairHostnameDns:[\s\S]*Promise<ApiResponse<SaaSDnsRepairResult>>/)
assert.doesNotMatch(saasApi, /repairHostnameDns:[\s\S]{0,180}Promise<ApiResponse<SaaSHostname>>/)
assert.match(dockerfile, /^HEALTHCHECK\s/m)
assert.match(dockerfile, /node[\s\S]*\/api\/health/)
assert.doesNotMatch(dockerfile, /HEALTHCHECK[\s\S]{0,300}\b(curl|wget)\b/)

const audit = spawnSync('npm', ['audit', '--json'], {
  cwd: new URL('../', import.meta.url),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
const report = JSON.parse(audit.stdout || '{}')
assert.equal(report.metadata?.vulnerabilities?.total, 0, 'all dependency vulnerabilities must be zero')
assert.equal(audit.status, 0, audit.stderr || audit.stdout)

console.log('maintenance-contract-probe=ok audit=0 saas-dto=narrow healthcheck=node')
