#!/usr/bin/env node
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const result = spawnSync('npm', ['ls', '--json', '--all'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
let tree
try {
  tree = JSON.parse(result.stdout || '{}')
} catch {
  process.stderr.write(result.stderr || result.stdout)
  process.exit(1)
}

const lock = JSON.parse(fs.readFileSync('node_modules/.package-lock.json', 'utf8'))
const optionalLocked = new Set(
  Object.entries(lock.packages || {})
    .filter(([, metadata]) => metadata?.optional === true)
    .map(([packagePath, metadata]) => {
      const marker = '/node_modules/'
      const index = packagePath.lastIndexOf(marker)
      const name = packagePath.slice(index >= 0 ? index + marker.length : 'node_modules/'.length)
      return `${name}@${metadata.version || 'unknown'}`
    })
)

const problems = new Set()
let optionalExtraneous = 0
function visit(node) {
  if (!node || typeof node !== 'object') return
  for (const [name, dependency] of Object.entries(node.dependencies || {})) {
    if (!dependency || typeof dependency !== 'object') continue
    const identity = `${name}@${dependency.version || 'unknown'}`
    if (dependency.extraneous) {
      if (optionalLocked.has(identity)) optionalExtraneous++
      else problems.add(`extraneous: ${identity}`)
    }
    if (dependency.invalid) problems.add(`invalid: ${identity}`)
    if (dependency.missing) problems.add(`missing: ${name}`)
    visit(dependency)
  }
}
visit(tree)

if (result.error) problems.add(result.error.message)
if (problems.size) {
  console.error([...problems].sort().join('\n'))
  process.exit(1)
}
console.log(`dependency-tree=ok optional-extraneous=${optionalExtraneous}`)
