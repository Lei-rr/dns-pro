import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'

const root = process.cwd()
const errors = []
const finalMode = process.env.ARCH_FINAL === '1' || process.argv.includes('--final')
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

const sourceFiles = [...walk('server'), ...walk('web/src')].filter((file) => /\.(?:ts|vue)$/.test(file))
const backendFiles = sourceFiles.filter((file) => file.startsWith('server/'))
const webFiles = sourceFiles.filter((file) => file.startsWith('web/src/'))

const cacheProductionFiles = walk('server/core/cache')
if (exists('server/core/events')) {
  report('ARCH010', 'server/core/events', 1, 'EventBus platform layer must not be recreated')
}
if (
  cacheProductionFiles.length !== 2 ||
  !cacheProductionFiles.includes('server/core/cache/memory-cache.ts') ||
  !cacheProductionFiles.includes('server/core/cache/provider-cache.ts')
) {
  report(
    'ARCH012',
    'server/core/cache',
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

function propertyNameOf(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  return null
}

/**
 * 错误码载体 → 取值表达式：
 * - new ApiError(...) / wrapProviderError(...) 的首参
 * - 对象字面量的 code / limitCode / notFoundCode 字段（callProvider 与分页上限走这里）
 * - `const xxxCode = ...` 局部变量（变量会传给 requireType 一类透传函数）
 * 其余形态（变量、成员访问、调用结果）静态不可判，由这里返回 null 跳过。
 */
function errorCodeValueOf(node) {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ApiError')
    return node.arguments?.[0] ?? null
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'wrapProviderError')
    return node.arguments?.[0] ?? null
  if (ts.isPropertyAssignment(node)) {
    const name = propertyNameOf(node.name)
    if (name === 'code' || name === 'limitCode' || name === 'notFoundCode') return node.initializer
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const name = node.name.text
    // code / errorCode / limitCode / probeCode 一类命名；全小写的 'unicode' 之类不在此列
    if (name === 'code' || /Code$/.test(name)) return node.initializer ?? null
  }
  return null
}

/** 模板骨架：插值统一替换为 ${}，保留静态片段（`${source}_provider_not_found` → '${}_provider_not_found'） */
function templateSkeleton(node) {
  let text = node.head.text
  for (const span of node.templateSpans) text += '${}' + span.literal.text
  return text
}

const imports = []
const apiErrorCodes = new Set()
const errorCodeTemplates = []
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
      // 错误码：字面量直接查中文映射；模板拼码的实际取值随变量变化、静态无法穷举，
      // 改由下方 errorCodeTemplateAllowlist 的骨架白名单收口（见 ARCH028 校验段）
      if (file.startsWith('server/')) {
        const value = errorCodeValueOf(node)
        if (value && ts.isStringLiteralLike(value)) apiErrorCodes.add(value.text)
        else if (value && ts.isTemplateExpression(value))
          errorCodeTemplates.push({
            skeleton: templateSkeleton(value),
            file,
            line: block.offset + lineAt(block.code, node.getStart(sf)),
          })
      }
      // 动态拼接的错误码（如 `${prefix}_${action}_failed`）无法静态穷举，
      // 因此约定集中声明为 *_ERROR_CODES 映射常量，由这里把每个字面量取值纳入检查
      if (
        file.startsWith('server/') &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /_ERROR_CODES$/.test(node.name.text) &&
        node.initializer
      ) {
        // `as const` 会把对象字面量包成 AsExpression，先解包再收集属性字面量
        const initializer = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer
        if (ts.isObjectLiteralExpression(initializer)) {
          for (const property of initializer.properties) {
            if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer))
              apiErrorCodes.add(property.initializer.text)
          }
        }
      }
      if (
        file.startsWith('server/') &&
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
  for (const file of backendFiles.filter((candidate) => candidate.startsWith('server/use-cases/'))) {
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
  if (file === 'server/main.ts') return 'shell'
  if (file.startsWith('server/types/')) return 'core'
  for (const layer of ['app', 'use-cases', 'modules', 'core', 'shared'])
    if (file.startsWith(`server/${layer}/`)) return layer
  return 'other'
}
function webLayer(file) {
  for (const layer of ['app', 'pages', 'features', 'shared']) if (file.startsWith(`web/src/${layer}/`)) return layer
  return 'other'
}
// 蓝图 §2.4：app → use-cases → modules → core → shared，只允许向右依赖
const backendAllowed = {
  shell: new Set(['shell', 'app', 'use-cases', 'modules', 'core', 'shared']),
  app: new Set(['app', 'use-cases', 'modules', 'core', 'shared']),
  'use-cases': new Set(['use-cases', 'modules', 'core', 'shared']),
  modules: new Set(['modules', 'core', 'shared']),
  core: new Set(['core', 'shared']),
  shared: new Set(['shared']),
  other: new Set(['shell', 'app', 'use-cases', 'modules', 'core', 'shared', 'other']),
}
const webAllowed = {
  app: new Set(['app', 'pages', 'features', 'shared']),
  pages: new Set(['pages', 'features', 'shared']),
  features: new Set(['features', 'shared']),
  shared: new Set(['shared']),
  other: new Set(['app', 'pages', 'features', 'shared', 'other']),
}

for (const edge of imports) {
  if (edge.from.startsWith('server/') && edge.to.startsWith('server/')) {
    const from = backendLayer(edge.from),
      to = backendLayer(edge.to)
    if (finalMode && !backendAllowed[from]?.has(to))
      report('ARCH001', edge.from, edge.line, `${from} must not import ${to}: ${edge.to}`)
    // 产品线边界（蓝图 §2.4）：cloudflare/saas 与 cloudflare/tunnel 互不引用，共享能力走底座（D2）
    const fromProduct = edge.from.match(/^server\/src\/domains\/cloudflare\/(saas|tunnel)\//)?.[1]
    const toProduct = edge.to.match(/^server\/src\/domains\/cloudflare\/(saas|tunnel)\//)?.[1]
    if (finalMode && fromProduct && toProduct && fromProduct !== toProduct)
      report('ARCH002', edge.from, edge.line, `cloudflare/${fromProduct} must not import cloudflare/${toProduct}`)
    const fromUseCase = edge.from.match(/^server\/src\/use-cases\/([^/]+)/)?.[1]
    const toUseCase = edge.to.match(/^server\/src\/use-cases\/([^/]+)/)?.[1]
    // derived-records 是跨产品线共享的 DNS 写入口（D3），允许被其他用例依赖
    if (finalMode && fromUseCase && toUseCase && fromUseCase !== toUseCase && toUseCase !== 'derived-records')
      report('ARCH003', edge.from, edge.line, `use-case ${fromUseCase} must not import use-case ${toUseCase}`)
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
    file.startsWith('server/') &&
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
    !['server/app/context.ts', 'server/app/modules.ts', 'server/core/store/store-registry.ts'].includes(file)
  )
    report('ARCH011', file, 1, 'new JsonStore is only allowed in composition root')
  if (
    /invalidateProviderCache/.test(code) &&
    file !== 'server/core/cache/provider-cache.ts' &&
    !file.endsWith('.cache.ts')
  )
    report('ARCH012', file, 1, 'cache invalidation is only allowed in provider-cache and domain cache helpers')
  if (/\b(?:globalCache|CacheManager|cacheManager|CacheSweeper|cacheSweep)\b|setInterval\s*\(/.test(code))
    report(
      'ARCH012',
      file,
      1,
      'cache forwarding layers and sweeper timers are forbidden (expiry/eviction is lazy, see AGENTS.md)'
    )
  if (finalMode && /rowOperationTokens|\bclaimRow\s*\(|\breleaseRow\s*\(/.test(code))
    report('ARCH029', file, 1, 'row mutation ownership must use shared useRowBusy')
  if (
    finalMode &&
    file === 'server/modules/cloudflare/cloudflare-zone.handlers.ts' &&
    /request\.body\.domain/.test(code)
  )
    report('ARCH030', file, 1, 'Cloudflare zone create accepts name only')
}

if (schemaRoutes !== routeCalls) report('ARCH013', 'server', 1, `${routeCalls - schemaRoutes} route(s) missing schema`)
const errorMessageMap = read('server/core/http/error-messages.ts')
const mappedErrorCodes = new Set(
  [...errorMessageMap.matchAll(/^\s*([a-zA-Z0-9_]+):\s*['"]/gm)].map((match) => match[1])
)
for (const code of apiErrorCodes) {
  if (!mappedErrorCodes.has(code))
    report('ARCH028', 'server/core/http/error-messages.ts', 1, `missing ApiError message: ${code}`)
}
// 模板拼码白名单：模板的实际取值由运行时变量决定（如 `${source}_provider_not_found` 的 source），
// 静态无法穷举；因此要求每个模板骨架在此显式登记，并列出现有调用点会产生的完整错误码。
// 登记的展开值必须全部已在 error-messages.ts 登记中文映射，否则中文界面会直出英文。
// 新增模板、或给模板新增取值来源时校验会失败，必须同步登记；条目不再被任何模板使用同样会失败（防白名单腐烂）。
const errorCodeTemplateAllowlist = new Map([
  [
    '${}_provider_not_found',
    {
      // DnsPodAccess.linkedProviderId：source 为 'edgeone' | 'saas'（DnsPodLinkSource），两个取值都已登记
      expansions: ['edgeone_provider_not_found', 'saas_provider_not_found'],
    },
  ],
  [
    '${}_dnspod_provider_missing',
    {
      // DnsPodAccess.requireLinkedProviderId：source 同上
      expansions: ['edgeone_dnspod_provider_missing', 'saas_dnspod_provider_missing'],
    },
  ],
  [
    '${}_fqdn_empty',
    {
      // DnsPodZoneCatalog.resolve：errorCodePrefix 目前只有 'saas'（coordinator / planner 调用点）
      expansions: ['saas_fqdn_empty'],
    },
  ],
  [
    '${}_dnspod_zone_not_found',
    {
      // DnsPodZoneCatalog.resolve / requireExplicit：errorCodePrefix 目前只有 'saas'
      expansions: ['saas_dnspod_zone_not_found'],
    },
  ],
])
for (const template of errorCodeTemplates) {
  const entry = errorCodeTemplateAllowlist.get(template.skeleton)
  if (!entry) {
    report('ARCH028', template.file, template.line, `unregistered error-code template: ${template.skeleton}`)
    continue
  }
  for (const code of entry.expansions) {
    if (!mappedErrorCodes.has(code))
      report(
        'ARCH028',
        'server/core/http/error-messages.ts',
        1,
        `error-code template ${template.skeleton} expands to unmapped code: ${code}`
      )
  }
}
const usedErrorCodeTemplates = new Set(errorCodeTemplates.map((template) => template.skeleton))
for (const skeleton of errorCodeTemplateAllowlist.keys()) {
  if (!usedErrorCodeTemplates.has(skeleton))
    report('ARCH028', 'scripts/check-architecture.mjs', 1, `stale error-code template whitelist entry: ${skeleton}`)
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
    if (file.startsWith('server/modules/') && /\brequest\.server\.ctx\.workflows\b/.test(code)) {
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

for (const dir of ['server', 'web/src']) {
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
  'server/compose',
  'server/app-context.ts',
  'server/config',
  'server/app.ts',
  'server/server.ts',
  'server/bootstrap',
  'server/plugins',
  'server/domains',
  'server/workflows',
  'server/platform',
  'server/lib',
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
