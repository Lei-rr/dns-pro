import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'

const root = process.cwd()
const errors = []
const finalMode = process.env.ARCH_FINAL === '1'
const normalize = (value) => value.replaceAll(path.sep, '/')
const absolute = (file) => path.join(root, file)
const exists = (file) => fs.existsSync(absolute(file))
const read = (file) => fs.readFileSync(absolute(file), 'utf8')
const walk = (dir) => {
  if (!exists(dir)) return []
  return fs.readdirSync(absolute(dir), { withFileTypes: true }).flatMap((entry) => {
    const next = path.posix.join(dir, entry.name)
    return entry.isDirectory() ? walk(next) : [next]
  })
}
const lineAt = (code, position) => code.slice(0, position).split('\n').length
const report = (rule, file, line, message) => errors.push(`${rule} ${file}:${line} ${message}`)

const sourceFiles = [...walk('server/src'), ...walk('web/src')].filter((file) => /\.(?:ts|vue)$/.test(file))
const backendFiles = sourceFiles.filter((file) => file.startsWith('server/src/'))
const webFiles = sourceFiles.filter((file) => file.startsWith('web/src/'))

const cacheProductionFiles = walk('server/src/platform/cache')
if (exists('server/src/platform/events')) {
  report('ARCH010', 'server/src/platform/events', 1, 'EventBus platform layer must not be recreated')
}
if (
  cacheProductionFiles.length !== 2 ||
  !cacheProductionFiles.includes('server/src/platform/cache/memory-cache.ts') ||
  !cacheProductionFiles.includes('server/src/platform/cache/provider-cache.ts')
) {
  report(
    'ARCH012',
    'server/src/platform/cache',
    1,
    'cache production implementation must contain only memory-cache.ts and provider-cache.ts'
  )
}

function scriptsFor(file) {
  const source = read(file)
  if (!file.endsWith('.vue')) return [{ code: source, offset: 0 }]
  const { descriptor, errors: parseErrors } = parseSfc(source, { filename: file })
  if (parseErrors.length) report('ARCH000', file, 1, `invalid Vue SFC: ${String(parseErrors[0])}`)
  return [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean)
    .map((block) => ({ code: block.content, offset: block.loc.start.line - 1 }))
}

function resolveImport(from, specifier) {
  let base
  if (specifier.startsWith('@/')) base = path.join(root, 'web/src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(absolute(from)), specifier)
  else return null
  const candidates = [base]
  if (base.endsWith('.js')) candidates.unshift(base.slice(0, -3) + '.ts')
  if (!path.extname(base)) candidates.push(`${base}.ts`, `${base}.vue`, path.join(base, 'index.ts'))
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
  return resolved ? normalize(path.relative(root, resolved)) : null
}

const imports = []
const apiErrorCodes = new Set()
const routeMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
let routeCalls = 0
let schemaRoutes = 0
for (const file of sourceFiles) {
  for (const block of scriptsFor(file)) {
    const sf = ts.createSourceFile(
      file,
      block.code,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.vue') ? ts.ScriptKind.TS : undefined
    )
    const visit = (node) => {
      let literal = null
      let typeOnly = false
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        literal = node.moduleSpecifier
        typeOnly = Boolean(node.importClause?.isTypeOnly || node.isTypeOnly)
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        literal = node.arguments[0]
      }
      if (literal && ts.isStringLiteralLike(literal)) {
        const target = resolveImport(file, literal.text)
        if (target)
          imports.push({ from: file, to: target, typeOnly, line: block.offset + lineAt(block.code, node.getStart(sf)) })
      }
      if (
        file.startsWith('server/src/') &&
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'ApiError' &&
        node.arguments?.[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        apiErrorCodes.add(node.arguments[0].text)
      }
      if (
        file.startsWith('server/src/') &&
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'app' &&
        routeMethods.has(node.expression.name.text)
      ) {
        routeCalls++
        const options = node.arguments[1]
        if (
          options &&
          ts.isObjectLiteralExpression(options) &&
          options.properties.some(
            (property) => ts.isPropertyAssignment(property) && property.name.getText(sf) === 'schema'
          )
        ) {
          schemaRoutes++
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

if (finalMode) {
  const forbiddenBatchJobFields = new Set(['items', 'execution_owner', 'execution_token', 'lease_until'])
  for (const file of backendFiles.filter((candidate) => candidate.startsWith('server/src/workflows/'))) {
    const code = read(file)
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
    const visit = (node) => {
      if (ts.isFunctionLike(node) && node.body) {
        const functionName =
          node.name?.getText(sf) ??
          (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : '')
        const isBatchPresenter =
          functionName.startsWith('present') ||
          (node.type != null && /\b(?:\w*BatchJobView|PreferredApplyJob)\b/.test(node.type.getText(sf)))
        const jobRecordParameters = new Set(
          node.parameters
            .filter((parameter) => parameter.type?.getText(sf) === 'JobRecord' && ts.isIdentifier(parameter.name))
            .map((parameter) => parameter.name.text)
        )
        if (isBatchPresenter && jobRecordParameters.size > 0) {
          const isJobRecordParameter = (expression) =>
            expression != null && ts.isIdentifier(expression) && jobRecordParameters.has(expression.text)
          const inspect = (child) => {
            if (child !== node.body && ts.isFunctionLike(child)) return
            if (ts.isPropertyAccessExpression(child) && isJobRecordParameter(child.expression)) {
              if (forbiddenBatchJobFields.has(child.name.text)) {
                report(
                  'ARCH031',
                  file,
                  lineAt(code, child.getStart(sf)),
                  `batch presenter must not expose JobRecord.${child.name.text}`
                )
              }
            }
            if (ts.isElementAccessExpression(child) && isJobRecordParameter(child.expression)) {
              const argument = child.argumentExpression
              const field =
                argument && (ts.isStringLiteralLike(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
                  ? argument.text
                  : null
              if (field == null || forbiddenBatchJobFields.has(field)) {
                report(
                  'ARCH031',
                  file,
                  lineAt(code, child.getStart(sf)),
                  field == null
                    ? 'batch presenter must not use dynamic computed JobRecord access'
                    : `batch presenter must not expose JobRecord.${field}`
                )
              }
            }
            if ((ts.isSpreadAssignment(child) || ts.isSpreadElement(child)) && isJobRecordParameter(child.expression)) {
              report('ARCH031', file, lineAt(code, child.getStart(sf)), 'batch presenter must not spread a JobRecord')
            }
            ts.forEachChild(child, inspect)
          }
          inspect(node.body)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

function backendLayer(file) {
  if (/^server\/src\/(?:app|server)\.ts$/.test(file)) return 'shell'
  if (file.startsWith('server/src/types/')) return 'shared'
  for (const layer of ['bootstrap', 'plugins', 'workflows', 'modules', 'platform', 'shared'])
    if (file.startsWith(`server/src/${layer}/`)) return layer
  return 'other'
}
function webLayer(file) {
  for (const layer of ['app', 'pages', 'features', 'shared']) if (file.startsWith(`web/src/${layer}/`)) return layer
  return 'other'
}
const backendAllowed = {
  shell: new Set(['shell', 'bootstrap', 'plugins', 'platform', 'shared']),
  bootstrap: new Set(['bootstrap', 'plugins', 'workflows', 'modules', 'platform', 'shared']),
  plugins: new Set(['bootstrap', 'platform', 'shared', 'modules']),
  workflows: new Set(['modules', 'platform', 'shared', 'workflows']),
  modules: new Set(['modules', 'platform', 'shared']),
  platform: new Set(['platform', 'shared']),
  shared: new Set(['shared']),
  other: new Set(['shell', 'bootstrap', 'plugins', 'workflows', 'modules', 'platform', 'shared', 'other']),
}
const webAllowed = {
  app: new Set(['app', 'pages', 'features', 'shared']),
  pages: new Set(['pages', 'features', 'shared']),
  features: new Set(['features', 'shared']),
  shared: new Set(['shared']),
  other: new Set(['app', 'pages', 'features', 'shared', 'other']),
}

for (const edge of imports) {
  if (edge.from.startsWith('server/src/') && edge.to.startsWith('server/src/')) {
    const from = backendLayer(edge.from),
      to = backendLayer(edge.to)
    if (finalMode && !backendAllowed[from]?.has(to))
      report('ARCH001', edge.from, edge.line, `${from} must not import ${to}: ${edge.to}`)
    const fromModule = edge.from.match(/^server\/src\/modules\/([^/]+)/)?.[1]
    const toModule = edge.to.match(/^server\/src\/modules\/([^/]+)/)?.[1]
    if (fromModule && toModule && fromModule !== toModule && toModule !== 'providers') {
      const allowed = new Set(['saas>cloudflare', 'tunnels>cloudflare'])
      if (finalMode && !allowed.has(`${fromModule}>${toModule}`))
        report('ARCH002', edge.from, edge.line, `module ${fromModule} must not deep-import module ${toModule}`)
    }
    const fromWorkflow = edge.from.match(/^server\/src\/workflows\/([^/]+)/)?.[1]
    const toWorkflow = edge.to.match(/^server\/src\/workflows\/([^/]+)/)?.[1]
    if (finalMode && fromWorkflow && toWorkflow && fromWorkflow !== toWorkflow)
      report('ARCH003', edge.from, edge.line, `workflow ${fromWorkflow} must not import workflow ${toWorkflow}`)
  }
  if (edge.from.startsWith('web/src/') && edge.to.startsWith('web/src/')) {
    const from = webLayer(edge.from),
      to = webLayer(edge.to)
    if (finalMode && !webAllowed[from]?.has(to))
      report('ARCH004', edge.from, edge.line, `${from} must not import ${to}: ${edge.to}`)
    const fromFeature = edge.from.match(/^web\/src\/features\/([^/]+)/)?.[1]
    const toFeature = edge.to.match(/^web\/src\/features\/([^/]+)/)?.[1]
    if (finalMode && fromFeature && toFeature && fromFeature !== toFeature)
      report('ARCH005', edge.from, edge.line, `feature ${fromFeature} must not import feature ${toFeature}`)
    if (
      finalMode &&
      edge.from.startsWith('web/src/features/auth/') &&
      edge.to.startsWith('web/src/features/providers/')
    )
      report('ARCH017', edge.from, edge.line, 'auth must not own provider cache lifecycle')
    if (finalMode && /\/api\//.test(edge.from) && /\/model\/(?:[^/]*-)?store\.ts$/.test(edge.to))
      report('ARCH018', edge.from, edge.line, 'business API must not import a store')
    const outsideFeature = toFeature && fromFeature !== toFeature
    if (finalMode && outsideFeature && edge.to !== `web/src/features/${toFeature}/index.ts`)
      report('ARCH019', edge.from, edge.line, `external feature consumers must use ${toFeature}/index.ts`)

    const ownDir = edge.from.match(/^(web\/src\/shared\/ui\/[^/]+)\//)?.[1]
    if (ownDir && edge.to === `${ownDir}/index.ts`)
      report('ARCH006', edge.from, edge.line, 'shared UI must not import its own barrel')
  }
}

// Runtime cycles (type-only edges do not count)
const graph = new Map(sourceFiles.map((file) => [file, []]))
for (const edge of imports)
  if (!edge.typeOnly && graph.has(edge.from) && graph.has(edge.to)) graph.get(edge.from).push(edge.to)
let index = 0
const stack = [],
  onStack = new Set(),
  indices = new Map(),
  low = new Map()
function strong(node) {
  indices.set(node, index)
  low.set(node, index)
  index += 1
  stack.push(node)
  onStack.add(node)
  for (const target of graph.get(node) ?? []) {
    if (!indices.has(target)) {
      strong(target)
      low.set(node, Math.min(low.get(node), low.get(target)))
    } else if (onStack.has(target)) low.set(node, Math.min(low.get(node), indices.get(target)))
  }
  if (low.get(node) === indices.get(node)) {
    const component = []
    let item
    do {
      item = stack.pop()
      onStack.delete(item)
      component.push(item)
    } while (item !== node)
    if (component.length > 1 || (graph.get(node) ?? []).includes(node))
      report('ARCH007', component.sort()[0], 1, `runtime import cycle: ${component.sort().join(' -> ')}`)
  }
}
for (const node of graph.keys()) if (!indices.has(node)) strong(node)

for (const file of sourceFiles) {
  const code = read(file)
  if (
    file.startsWith('server/src/') &&
    !file.endsWith('.d.ts') &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\.ts$/.test(path.basename(file))
  )
    report('ARCH008', file, 1, 'backend TypeScript filename must be kebab-case')
  if (file.endsWith('.vue') && !/^[A-Z][A-Za-z0-9]*\.vue$/.test(path.basename(file)))
    report('ARCH009', file, 1, 'Vue filename must be PascalCase')
  if (/\b(?:eventBus|EventBus|DomainEvent)\b|event-bus/.test(code))
    report('ARCH010', file, 1, 'EventBus platform layer and event envelopes are forbidden')
  if (
    /new JsonStore\s*(?:<|\()/.test(code) &&
    !['server/src/bootstrap/create-platform.ts', 'server/src/bootstrap/create-modules.ts'].includes(file)
  )
    report('ARCH011', file, 1, 'new JsonStore is only allowed in composition root')
  if (
    /invalidateProviderCache/.test(code) &&
    file !== 'server/src/platform/cache/provider-cache.ts' &&
    !file.endsWith('.cache.ts')
  )
    report('ARCH012', file, 1, 'cache invalidation is only allowed in provider-cache and domain cache helpers')
  if (/\b(?:CacheTtl|ttlMs|cacheMaxEntries|cacheSweepIntervalMs|globalCache|CacheManager|cacheManager)\b/.test(code))
    report('ARCH012', file, 1, 'cache TTL, capacity, sweeper, and forwarding manager layers are forbidden')
  if (finalMode && /rowOperationTokens|\bclaimRow\s*\(|\breleaseRow\s*\(/.test(code))
    report('ARCH029', file, 1, 'row mutation ownership must use shared useRowBusy')
  if (
    finalMode &&
    file === 'server/src/modules/cloudflare/cloudflare-zone.handlers.ts' &&
    /request\.body\.domain/.test(code)
  )
    report('ARCH030', file, 1, 'Cloudflare zone create accepts name only')
}

if (schemaRoutes !== routeCalls)
  report('ARCH013', 'server/src', 1, `${routeCalls - schemaRoutes} route(s) missing schema`)
const errorMessageMap = read('server/src/shared/http/error-messages.ts')
const mappedErrorCodes = new Set(
  [...errorMessageMap.matchAll(/^\s*([a-zA-Z0-9_]+):\s*['"]/gm)].map((match) => match[1])
)
for (const code of apiErrorCodes) {
  if (!mappedErrorCodes.has(code))
    report('ARCH028', 'server/src/shared/http/error-messages.ts', 1, `missing ApiError message: ${code}`)
}
for (const file of backendFiles)
  if (/\bapp\.(?:get|post|put|patch|delete|head|options)\s*\(/.test(read(file)) && !file.endsWith('.routes.ts'))
    report('ARCH014', file, 1, 'Fastify route declarations belong in *.routes.ts')

if (finalMode) {
  // Keep this gate structural. Stateful business invariants belong in deterministic
  // isolated probes so equivalent refactors remain valid and semantic regressions fail.
  for (const file of backendFiles.filter((candidate) => candidate.endsWith('.handlers.ts'))) {
    const code = read(file)
    for (const match of code.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
      if (!match[1].endsWith('Handler'))
        report('ARCH021', file, lineAt(code, match.index), `handler export must end with Handler: ${match[1]}`)
    }
    if (/\b(?:bodyRecord|queryRecord|queryBool|bodyString)\s*\(/.test(code))
      report('ARCH022', file, 1, 'handlers must consume schema-derived request types directly')
    for (const match of code.matchAll(/\brequest\s*:\s*FastifyRequest(?!\s*<\s*RequestOf\s*<\s*typeof\s+)/g)) {
      report('ARCH026', file, lineAt(code, match.index), 'every handler request must use RequestOf<typeof schema>')
    }
    if (file.startsWith('server/src/modules/') && /\brequest\.server\.ctx\.workflows\b/.test(code)) {
      report('ARCH027', file, 1, 'module handlers must not call workflows')
    }
  }
  for (const file of backendFiles.filter((candidate) => candidate.endsWith('.workflow.ts'))) {
    const code = read(file)
    for (const match of code.matchAll(/export\s+class\s+(\w+)/g)) {
      if (!match[1].endsWith('Workflow'))
        report('ARCH023', file, lineAt(code, match.index), `workflow class must end with Workflow: ${match[1]}`)
    }
  }
  for (const file of backendFiles) {
    const code = read(file)
    for (const match of code.matchAll(/\b(?:request\.server|app)\.ctx\.([A-Za-z_$][\w$]*)/g)) {
      if (!['config', 'platform', 'modules', 'workflows'].includes(match[1]))
        report('ARCH024', file, lineAt(code, match.index), `flat AppContext access is forbidden: ctx.${match[1]}`)
    }
  }
  for (const file of backendFiles.filter((candidate) => candidate.endsWith('.handlers.ts'))) {
    if (/request-parse\.js/.test(read(file)))
      report('ARCH025', file, 1, 'handlers must not import the legacy request-parse helper')
  }
}

for (const dir of ['server/src', 'web/src']) {
  for (const candidate of walk(dir).map((file) => path.posix.dirname(file))) {
    if (
      exists(candidate) &&
      fs.statSync(absolute(candidate)).isDirectory() &&
      fs.readdirSync(absolute(candidate)).length === 0
    )
      report('ARCH015', candidate, 1, 'empty directory')
  }
}

const forbiddenLegacy = [
  'src',
  'server/src/compose',
  'server/src/app-context.ts',
  'server/src/lib',
  'server/src/config',
  'server/src/platform/job',
  'server/src/modules/provider',
  'server/src/modules/dnspod',
  'server/src/modules/edgeone',
  'server/src/modules/cloudflared',
  'server/src/modules/dns-batch',
  'server/src/modules/sync',
  'web/src/main.ts',
  'web/src/layouts',
  'web/src/router',
  'web/src/styles',
  'web/src/shared/types',
  'web/src/entities',
  'web/src/widgets',
  'web/src/processes',
  'web/src/features/dashboard',
  'web/src/features/cloudflared',
]
if (finalMode)
  for (const legacy of forbiddenLegacy) if (exists(legacy)) report('ARCH016', legacy, 1, 'legacy path must be removed')

if (errors.length) {
  console.error(`Architecture check failed (${errors.length}):`)
  for (const error of errors.sort()) console.error(error)
  process.exit(1)
}
console.log(`architecture=ok files=${sourceFiles.length} imports=${imports.length} routes=${routeCalls}`)
