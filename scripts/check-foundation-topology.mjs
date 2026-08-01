#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []
const exists = (relative) => fs.existsSync(path.join(root, relative))
const walk = (relative) => {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) return []
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

const cacheFiles = walk('src/platform/cache')
  .filter((file) => file.endsWith('.ts'))
  .sort()
const expectedCache = ['src/platform/cache/memory-cache.ts', 'src/platform/cache/provider-cache.ts']
if (JSON.stringify(cacheFiles) !== JSON.stringify(expectedCache)) {
  failures.push(`cache topology: ${cacheFiles.join(', ')}`)
}

for (const forbidden of ['web/src/entities', 'web/src/widgets', 'web/src/processes']) {
  if (exists(forbidden)) failures.push(`forbidden frontend layer: ${forbidden}`)
}

const productionFiles = [...walk('src'), ...walk('web/src')].filter((file) => /\.(?:ts|vue)$/.test(file))
const distributedPatterns = /\b(?:execution_owner|execution_token|lease_until|AsyncLocalStorage|FileMutex)\b/
for (const file of productionFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  if (distributedPatterns.test(source)) failures.push(`distributed infrastructure residue: ${file}`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`foundation-topology=ok production_files=${productionFiles.length}`)
