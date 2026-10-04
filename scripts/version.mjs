#!/usr/bin/env node
/**
 * Version single-source tooling.
 *
 * The root package.json is the only version written by hand.
 *   sync  — propagate it to web/package.json and server/src/kernel/version.ts
 *   check — fail when any copy drifts (wired into `npm run verify`)
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const rootPkgPath = path.join(root, 'package.json')
const webPkgPath = path.join(root, 'web', 'package.json')
const versionTsPath = path.join(root, 'server', 'src', 'kernel', 'version.ts')

function tsSource(version) {
  return `/**
 * Application version — generated from the root package.json by scripts/version.mjs.
 * Run \`npm run version:sync\` after bumping it; \`npm run version:check\` guards against drift.
 */
export const APP_VERSION = '${version}'
`
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function readRootVersion() {
  const pkg = await readJson(rootPkgPath)
  const version = pkg.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
    throw new Error(`package.json has an invalid version: ${JSON.stringify(version)}`)
  }
  return version
}

async function writeJsonWithVersion(file, version) {
  const raw = await readFile(file, 'utf8')
  const pkg = JSON.parse(raw)
  pkg.version = version
  const indent = /^\{\n(\s+)/.exec(raw)?.[1] ?? '  '
  await writeFile(file, `${JSON.stringify(pkg, null, indent)}\n`, 'utf8')
}

async function currentVersionTs() {
  const source = await readFile(versionTsPath, 'utf8')
  return /APP_VERSION\s*=\s*'([^']+)'/.exec(source)?.[1] ?? null
}

async function sync() {
  const version = await readRootVersion()
  await writeJsonWithVersion(webPkgPath, version)
  await writeFile(versionTsPath, tsSource(version), 'utf8')
  console.log(`version-sync=ok version=${version}`)
}

async function check() {
  const version = await readRootVersion()
  const [web, ts] = await Promise.all([readJson(webPkgPath), currentVersionTs()])
  const drift = []
  if (web.version !== version) drift.push(`web/package.json=${web.version}`)
  if (ts !== version) drift.push(`server/src/kernel/version.ts=${ts}`)

  if (drift.length > 0) {
    console.error(`version-check=failed expected=${version} ${drift.join(' ')}`)
    console.error('Run `npm run version:sync` to realign every copy.')
    process.exitCode = 1
    return
  }
  console.log(`version-check=ok version=${version}`)
}

const command = process.argv[2]
const run = command === 'sync' ? sync : command === 'check' ? check : null
if (!run) {
  console.error('usage: node scripts/version.mjs <sync|check>')
  process.exitCode = 2
} else {
  await run()
}
