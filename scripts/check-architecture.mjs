import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { parse as parseSfc } from '@vue/compiler-sfc'

/**
 * 架构守卫：单文件脚本，直接 node 运行（npm run arch / arch:final）。
 *
 * 执行范围与披露（曾经的缺陷：默认模式静默少跑 19 条 finalMode 门控规则，两种模式的 ok 行文本却完全一致）：
 * - 默认（`npm run arch`、`npm run arch:final`、CI 的 npm run verify）执行**全部**规则；
 * - `--fast`（或 ARCH_FAST=1）才跳过 full 规则，供本地快速迭代，且失败/成功行都会披露 final 与 rules 执行范围；
 * - 全量模式下由 ARCH099 自检「规则清单里声明过的规则是否真的被执行过」，防止清单与实际检查脱节。
 *
 * 解析口径（见 ARCH033/ARCH035 段）：相对路径与 tsconfig 别名一律解析到仓库内文件；
 * 解析失败的项目内说明符、无法静态判定的动态 import() 实参都会被显式报错，而不是静默丢边。
 */
const root = process.cwd()
const errors = []

/** 规则清单：always = 两种模式都执行；full = 仅全量模式执行（--fast 跳过）。 */
const ruleScopes = new Map([
  ['ARCH000', 'always'],
  ['ARCH001', 'full'],
  ['ARCH002', 'full'],
  ['ARCH003', 'full'],
  ['ARCH004', 'full'],
  ['ARCH005', 'full'],
  ['ARCH006', 'always'],
  ['ARCH007', 'always'],
  ['ARCH008', 'always'],
  ['ARCH009', 'always'],
  ['ARCH010', 'always'],
  ['ARCH011', 'always'],
  ['ARCH012', 'always'],
  ['ARCH013', 'always'],
  ['ARCH014', 'always'],
  ['ARCH015', 'always'],
  ['ARCH016', 'full'],
  ['ARCH017', 'full'],
  ['ARCH018', 'full'],
  ['ARCH019', 'full'],
  ['ARCH021', 'full'],
  ['ARCH022', 'full'],
  ['ARCH023', 'full'],
  ['ARCH024', 'full'],
  ['ARCH025', 'full'],
  ['ARCH026', 'full'],
  ['ARCH027', 'full'],
  ['ARCH028', 'always'],
  ['ARCH029', 'full'],
  ['ARCH030', 'full'],
  ['ARCH031', 'full'],
  ['ARCH032', 'always'],
  ['ARCH033', 'always'],
  ['ARCH034', 'always'],
  ['ARCH035', 'always'],
])
const fastMode = process.argv.includes('--fast') || process.env.ARCH_FAST === '1'
const finalMode = !fastMode
const executedRules = new Set()
/**
 * 规则门控：只有清单里声明过的规则才能被门控（打错规则号会立刻抛错）。
 * 传入多个规则号时，任一规则在当前模式被禁用则整块跳过，并登记本块真正执行过的规则。
 */
const runs = (...ids) => {
  for (const id of ids) if (!ruleScopes.has(id)) throw new Error(`unknown architecture rule: ${id}`)
  for (const id of ids) if (ruleScopes.get(id) === 'full' && fastMode) return false
  for (const id of ids) executedRules.add(id)
  return true
}

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
/** 真正枚举目录（walk 只返回文件，曾导致 ARCH015 恒为假） */
const walkDirectories = (dir) => {
  if (!exists(dir)) return []
  return fs.readdirSync(absolute(dir), { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    const next = path.posix.join(dir, entry.name)
    return [next, ...walkDirectories(next)]
  })
}
const lineAt = (code, position) => code.slice(0, position).split('\n').length
const report = (rule, file, line, message) => errors.push(`${rule} ${file}:${line} ${message}`)

/**
 * 路径别名不再硬编码：从 web/tsconfig.json 的 compilerOptions.paths 推导（@/* → web/src、@server/* → server），
 * 别名映射缺失或指向不存在的目录由 ARCH035 报错，避免「改了别名映射、守卫仍然按老路径解析」的静默失效。
 */
const aliasConfigPath = 'web/tsconfig.json'
const aliases = []
let aliasConfigError = null
{
  const configFile = ts.readConfigFile(absolute(aliasConfigPath), (file) => fs.readFileSync(file, 'utf8'))
  if (configFile.error) {
    aliasConfigError = `cannot read ${aliasConfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, ' ')}`
  } else {
    const options = configFile.config?.compilerOptions ?? {}
    const webBase = path.resolve(path.join(root, 'web'), options.baseUrl ?? '.')
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const star = pattern.indexOf('*')
      if (star < 0 || !Array.isArray(targets) || targets.length === 0) continue
      const target = String(targets[0])
      const targetStar = target.indexOf('*')
      const targetBase = targetStar < 0 ? target : target.slice(0, targetStar)
      aliases.push({
        prefix: pattern.slice(0, star),
        dir: normalize(path.relative(root, path.resolve(webBase, targetBase))),
      })
    }
    if (aliases.length === 0) aliasConfigError = `${aliasConfigPath} 的 compilerOptions.paths 为空：别名导入无法解析`
  }
}

/**
 * 测试文件（*.test.ts / *.spec.ts，由 vitest 运行，见 vitest.config.ts）不参与生产架构规则：
 * 命名、分层依赖、运行时循环、错误码登记等约束只针对生产代码。这里在数据源处统一剔除，
 * 而不是给每条规则单独加例外 —— 既保证测试文件不误报，也保证生产代码的约束一条不减。
 */
const isTestFile = (file) => /\.(?:test|spec)\.[cm]?tsx?$/.test(file)
const discoveredFiles = [...walk('server'), ...walk('web/src')].filter((file) => /\.(?:ts|vue)$/.test(file))
const testFiles = discoveredFiles.filter(isTestFile)
const sourceFiles = discoveredFiles.filter((file) => !isTestFile(file))
const backendFiles = sourceFiles.filter((file) => file.startsWith('server/'))
const webFiles = sourceFiles.filter((file) => file.startsWith('web/src/'))

const cacheProductionFiles = walk('server/core/cache').filter((file) => !isTestFile(file))
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
  if (parseErrors.length) vueParseErrors.push({ file, message: String(parseErrors[0]) })
  return [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean)
    .map((block) => ({ code: block.content, offset: block.loc.start.line - 1 }))
}

/** 项目内说明符 = 相对路径或 tsconfig 别名；裸包名（vue、zod 等）不在此列 */
const isProjectSpecifier = (specifier) =>
  specifier.startsWith('.') || aliases.some((alias) => specifier.startsWith(alias.prefix))

function resolveImport(from, specifier) {
  let base = null
  for (const alias of aliases) {
    if (specifier.startsWith(alias.prefix)) {
      base = path.join(root, alias.dir, specifier.slice(alias.prefix.length))
      break
    }
  }
  if (base === null && specifier.startsWith('.')) base = path.resolve(path.dirname(absolute(from)), specifier)
  if (base === null) return null
  const candidates = [base]
  if (base.endsWith('.js')) candidates.unshift(base.slice(0, -3) + '.ts')
  if (!path.extname(base)) candidates.push(`${base}.ts`, `${base}.vue`, path.join(base, 'index.ts'))
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
  return resolved ? normalize(path.relative(root, resolved)) : null
}

/**
 * 类型擦除判定与 tsc / esbuild 对齐：
 * - `import type { X }` / `export type { X }`（语句级）→ 类型边；
 * - `import { type X } from`、`import { type X, type Y } from`（命名导入**全部**带 type 修饰符）→ 类型边；
 * - 默认导入、命名空间导入、`export * from`、混合导入（含运行时绑定的）→ 运行时边。
 * （此前只认语句级 type，全仓 108 处内联写法被误判成运行时边，互引即报假循环。）
 */
function isTypeOnlyEdge(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (!clause) return false
    if (clause.isTypeOnly) return true
    if (clause.name) return false
    const bindings = clause.namedBindings
    if (!bindings) return false
    if (ts.isNamespaceImport(bindings)) return false
    return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true
    const clause = node.exportClause
    if (clause && ts.isNamedExports(clause) && clause.elements.length > 0)
      return clause.elements.every((element) => element.isTypeOnly)
    return false
  }
  return false
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

/** 去掉括号 / as 断言 / satisfies / 非空断言，取到真正承载语义的表达式 */
function unwrapExpression(node) {
  let current = node
  while (current) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression
      continue
    }
    return current
  }
  return null
}

/** 类型节点 → 类型名（联合/交叉展开；内联结构类型没有名字，返回空数组表示「不可判」） */
function typeNamesOfTypeNode(node) {
  if (!node) return []
  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName
    if (ts.isIdentifier(typeName)) return [typeName.text]
    if (ts.isQualifiedName(typeName)) return [typeName.right.text]
    return []
  }
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.flatMap(typeNamesOfTypeNode)
  if (ts.isParenthesizedTypeNode(node)) return typeNamesOfTypeNode(node.type)
  return []
}

function membersOfTypeLiteral(node) {
  const members = new Map()
  for (const member of node.members) {
    if ((ts.isPropertySignature(member) || ts.isMethodSignature(member)) && member.name && member.type) {
      const name = propertyNameOf(member.name)
      if (name) members.set(name, { names: typeNamesOfTypeNode(member.type), members: null })
    }
  }
  return members
}

/**
 * 文件内最小符号表：只服务于两处静态判定
 * - ARCH028：接收者到底是不是「错误码前缀载体」（DnsPodZoneCatalog / DnsPodAccess 一族），而不是只看末段名 + 实参个数；
 * - ARCH013：路由选项被抽成变量（含 as const / spread）时仍能认出 schema。
 */
function collectSymbols(sf) {
  const typeDeclarations = new Map()
  const declaredTypeNames = new Set()
  const objectLiterals = new Map()
  const instanceTypes = new Map()
  const typeMemberCache = new Map()

  const collect = (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      declaredTypeNames.add(node.name.text)
    } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name) {
      declaredTypeNames.add(node.name.text)
      typeDeclarations.set(node.name.text, node)
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = unwrapExpression(node.initializer)
      if (initializer && ts.isObjectLiteralExpression(initializer)) objectLiterals.set(node.name.text, initializer)
      else if (initializer && ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression))
        instanceTypes.set(node.name.text, initializer.expression.text)
    }
    ts.forEachChild(node, collect)
  }
  collect(sf)

  /** 解析类型名 → 成员类型表（interface / type alias，支持交叉与别名互引；带 visited 防环） */
  const membersOfTypeName = (typeName, visited = new Set()) => {
    if (typeMemberCache.has(typeName)) return typeMemberCache.get(typeName)
    if (visited.has(typeName)) return null
    visited.add(typeName)
    const declaration = typeDeclarations.get(typeName)
    let members = null
    if (declaration && ts.isInterfaceDeclaration(declaration)) {
      members = membersOfTypeLiteral({ members: declaration.members })
    } else if (declaration && ts.isTypeAliasDeclaration(declaration)) {
      members = membersOfTypeNode(declaration.type, visited)
    }
    typeMemberCache.set(typeName, members)
    return members
  }
  const membersOfTypeNode = (node, visited = new Set()) => {
    if (!node) return null
    if (ts.isTypeLiteralNode(node)) return membersOfTypeLiteral(node)
    if (ts.isIntersectionTypeNode(node)) {
      const merged = new Map()
      for (const part of node.types) {
        const partMembers = membersOfTypeNode(part, visited)
        if (!partMembers) continue
        for (const [key, value] of partMembers) merged.set(key, value)
      }
      return merged.size > 0 ? merged : null
    }
    if (ts.isParenthesizedTypeNode(node)) return membersOfTypeNode(node.type, visited)
    if (ts.isTypeReferenceNode(node)) {
      const [typeName] = typeNamesOfTypeNode(node)
      return typeName ? membersOfTypeName(typeName, visited) : null
    }
    return null
  }
  return { declaredTypeNames, objectLiterals, instanceTypes, membersOfTypeName }
}

/**
 * 错误码前缀的静态取值来源（供模板白名单反向对账）：
 * - DnsPodZoneCatalog.resolve / requireExplicit：实参 3（形如 *.catalog.* 的调用点）
 * - DnsPodAccess.linkedProviderId / requireLinkedProviderId：实参 2（形如 *.access.* 的调用点）
 * 前缀一律要求字面量：变量化会让静态对账失明，因此直接判错。
 * carrierTypes 是「前缀载体」的类型集合（实现类 + 端口）：只有接收者可判为该族时才按前缀口径判定，
 * 结构与名字都不像的接收者（如 Cloudflare ZoneCatalog.resolve(id, host, refresh = false)，
 * 第三参是布尔刷新标志）不再误报；接收者类型不可判时仍按严格口径要求字面量。
 */
const errorCodePrefixSources = new Map([
  ['catalog.resolve', { argument: 2, minArgs: 3, carrierTypes: ['DnsPodZoneCatalog', 'DnsZoneCatalogPort'] }],
  ['catalog.requireExplicit', { argument: 2, minArgs: 3, carrierTypes: ['DnsPodZoneCatalog', 'DnsZoneCatalogPort'] }],
  ['access.linkedProviderId', { argument: 1, minArgs: 3, carrierTypes: ['DnsPodAccess', 'LinkedDnsAccountPort'] }],
  [
    'access.requireLinkedProviderId',
    { argument: 1, minArgs: 3, carrierTypes: ['DnsPodAccess', 'LinkedDnsAccountPort'] },
  ],
])
const errorCodePrefixUsages = new Map([...errorCodePrefixSources.keys()].map((key) => [key, new Map()]))

/** 实参是否可能是错误码前缀：布尔 / 数字 / 对象 / 数组 / 函数等字面量不可能是前缀，直接放过 */
function canBeErrorCodePrefix(node) {
  const expression = unwrapExpression(node)
  if (!expression) return false
  if (ts.isStringLiteralLike(expression)) return true
  if (ts.isTemplateExpression(expression)) return true
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression) ||
    ts.isCallExpression(expression) ||
    ts.isConditionalExpression(expression) ||
    ts.isBinaryExpression(expression) ||
    ts.isAwaitExpression(expression)
  )
    return true
  return false
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
const vueParseErrors = []
const unresolvedSpecifiers = []
const dynamicImportArguments = []
const declaredTypeNames = new Set()
const routeMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
let routeCalls = 0
let schemaRoutes = 0

/** 规则门控（扫描期规则）：在遍历前求值，保证执行范围统计不依赖「是否存在违规样本」 */
const checkVueSfc = runs('ARCH000')
const checkEdgeFull = runs('ARCH001', 'ARCH002', 'ARCH003', 'ARCH004', 'ARCH005', 'ARCH017', 'ARCH018', 'ARCH019')
const checkEdgeAlways = runs('ARCH006', 'ARCH032')
const checkCycles = runs('ARCH007')
const checkFileNaming = runs('ARCH008', 'ARCH009')
const checkFileRuntimeRules = runs('ARCH010', 'ARCH011', 'ARCH012')
const checkPerFileFull = runs('ARCH029', 'ARCH030')
const checkRouteSchema = runs('ARCH013')
const checkRoutesFile = runs('ARCH014')
const checkEmptyDirs = runs('ARCH015')
const checkLayout = runs('ARCH035')
const checkLegacyPaths = runs('ARCH016')
const checkErrorCodes = runs('ARCH028')
const checkUnresolved = runs('ARCH033')
const checkDynamicImport = runs('ARCH034')
const checkBatchPresenter = runs('ARCH031')
const checkHandlerShape = runs('ARCH021', 'ARCH022', 'ARCH026', 'ARCH027')
const checkWorkflowClass = runs('ARCH023')
const checkAppContext = runs('ARCH024')
const checkLegacyRequestParse = runs('ARCH025')

/** 结构化对象字面量是否提供 schema（支持变量、as const / satisfies、spread 组合，深度上限 4 防环） */
function literalProvidesSchema(node, symbols, depth = 0, seen = new Set()) {
  if (depth > 4) return false
  const expression = unwrapExpression(node)
  if (!expression) return false
  let literal = null
  if (ts.isObjectLiteralExpression(expression)) literal = expression
  else if (ts.isIdentifier(expression)) {
    if (seen.has(expression.text)) return false
    seen.add(expression.text)
    literal = symbols.objectLiterals.get(expression.text) ?? null
  }
  if (!literal) return false
  for (const property of literal.properties) {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      if (propertyNameOf(property.name) === 'schema') return true
    } else if (ts.isSpreadAssignment(property) && literalProvidesSchema(property.expression, symbols, depth + 1, seen))
      return true
  }
  return false
}

for (const file of sourceFiles) {
  for (const block of scriptsFor(file)) {
    const sf = ts.createSourceFile(
      file,
      block.code,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.vue') ? ts.ScriptKind.TS : undefined
    )
    const symbols = collectSymbols(sf)
    for (const name of symbols.declaredTypeNames) declaredTypeNames.add(name)
    const lineOf = (node) => block.offset + lineAt(block.code, node.getStart(sf))

    /**
     * 接收者表达式的静态归属：返回 { names, members, synthetic } 或 null（不可判）。
     * names 为空且 members 非空 = 内联结构类型（没有类型名，按「不可判」处理）。
     */
    const ownerTypeInfo = (node, scope) => {
      if (!node) return null
      if (node.kind === ts.SyntaxKind.ThisKeyword) {
        return scope.className ? { names: [scope.className], members: null, synthetic: false } : null
      }
      if (ts.isIdentifier(node)) {
        const local = scope.locals.get(node.text)
        if (local) return local
        const instanceType = symbols.instanceTypes.get(node.text)
        return instanceType ? { names: [instanceType], members: null, synthetic: false } : null
      }
      if (ts.isPropertyAccessExpression(node)) {
        const owner = ownerTypeInfo(node.expression, scope)
        if (!owner) return null
        const member = node.name.text
        if (owner.members) return owner.members.get(member) ?? null
        for (const name of owner.names) {
          const resolved = symbols.membersOfTypeName(name)
          if (resolved?.has(member)) return resolved.get(member)
        }
        return null
      }
      return null
    }

    const visit = (node, scope) => {
      let nextScope = scope
      if (ts.isFunctionLike(node)) {
        const locals = new Map(scope.locals)
        for (const parameter of node.parameters) {
          if (!ts.isIdentifier(parameter.name)) continue
          if (parameter.type && ts.isTypeLiteralNode(parameter.type)) {
            locals.set(parameter.name.text, {
              names: [],
              members: membersOfTypeLiteral(parameter.type),
              synthetic: true,
            })
          } else {
            const names = typeNamesOfTypeNode(parameter.type)
            if (names.length > 0) locals.set(parameter.name.text, { names, members: null, synthetic: false })
          }
        }
        nextScope = { className: scope.className, locals }
      }
      if (ts.isClassDeclaration(node) && node.name) nextScope = { className: node.name.text, locals: scope.locals }

      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const literal = node.moduleSpecifier
        if (literal && ts.isStringLiteralLike(literal)) {
          const target = resolveImport(file, literal.text)
          if (target) imports.push({ from: file, to: target, typeOnly: isTypeOnlyEdge(node), line: lineOf(node) })
          else if (isProjectSpecifier(literal.text))
            unresolvedSpecifiers.push({ file, line: lineOf(node), specifier: literal.text })
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const literal = node.arguments[0]
        if (!literal || !ts.isStringLiteralLike(literal))
          dynamicImportArguments.push({ file, line: lineOf(node), text: node.getText(sf).slice(0, 80) })
        else {
          const target = resolveImport(file, literal.text)
          if (target) imports.push({ from: file, to: target, typeOnly: false, line: lineOf(node) })
          else if (isProjectSpecifier(literal.text))
            unresolvedSpecifiers.push({ file, line: lineOf(node), specifier: literal.text })
        }
      }

      // 错误码：字面量直接查中文映射；模板拼码的实际取值随变量变化、静态无法穷举，
      // 改由下方 errorCodeTemplateAllowlist 的骨架白名单收口（见 ARCH028 校验段）
      if (checkErrorCodes && file.startsWith('server/')) {
        const value = errorCodeValueOf(node)
        if (value && ts.isStringLiteralLike(value)) apiErrorCodes.add(value.text)
        else if (value && ts.isTemplateExpression(value))
          errorCodeTemplates.push({ skeleton: templateSkeleton(value), file, line: lineOf(node) })
      }
      // 错误码前缀的实际取值来源：静态收集，供白名单反向对账（前缀必须字面量，见下方 ARCH028 校验段）
      if (
        checkErrorCodes &&
        file.startsWith('server/') &&
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method = node.expression.name.text
        const receiver = node.expression.expression
        const receiverName = ts.isIdentifier(receiver)
          ? receiver.text
          : ts.isPropertyAccessExpression(receiver)
            ? receiver.name.text
            : ''
        const sourceKey = `${receiverName}.${method}`
        const spec = errorCodePrefixSources.get(sourceKey)
        if (spec && node.arguments.length >= spec.minArgs) {
          const owner = ownerTypeInfo(receiver, scope)
          // 接收者可判且不属于前缀载体（如 Cloudflare ZoneCatalog）：整条调用与本规则无关
          const provablyNotCarrier =
            owner !== null &&
            !owner.synthetic &&
            owner.names.length > 0 &&
            !owner.names.some((name) => spec.carrierTypes.includes(name))
          const argument = node.arguments[spec.argument]
          if (!provablyNotCarrier && canBeErrorCodePrefix(argument)) {
            if (ts.isStringLiteralLike(unwrapExpression(argument))) {
              const usage = errorCodePrefixUsages.get(sourceKey)
              const text = unwrapExpression(argument).text
              if (usage && !usage.has(text)) usage.set(text, { file, line: lineOf(node) })
            } else {
              report(
                'ARCH028',
                file,
                lineOf(node),
                `${sourceKey} errorCodePrefix must be a string literal for static audit`
              )
            }
          }
        }
      }
      // 动态拼接的错误码（如 `${prefix}_${action}_failed`）无法静态穷举，
      // 因此约定集中声明为 *_ERROR_CODES 映射常量，由这里把每个字面量取值纳入检查
      if (
        checkErrorCodes &&
        file.startsWith('server/') &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /_ERROR_CODES$/.test(node.name.text) &&
        node.initializer
      ) {
        // `as const` 会把对象字面量包成 AsExpression，先解包再收集属性字面量
        const initializer = unwrapExpression(node.initializer)
        if (initializer && ts.isObjectLiteralExpression(initializer)) {
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
        // schema 可以内联，也可以抽成变量（含 as const / satisfies / spread 组合）——抽出即误报曾是 ARCH013 的缺陷
        if (literalProvidesSchema(node.arguments[1], symbols)) schemaRoutes++
      }
      ts.forEachChild(node, (child) => visit(child, nextScope))
    }
    visit(sf, { className: null, locals: new Map() })
  }
}

if (checkEdgeFull || checkEdgeAlways) {
  function backendLayer(file) {
    if (file === 'server/main.ts') return 'shell'
    if (file.startsWith('server/types/')) return 'core'
    for (const layer of ['app', 'workflows', 'modules', 'core', 'shared'])
      if (file.startsWith(`server/${layer}/`)) return layer
    return 'other'
  }
  function webLayer(file) {
    for (const layer of ['app', 'pages', 'features', 'shared']) if (file.startsWith(`web/src/${layer}/`)) return layer
    return 'other'
  }
  // 蓝图 §2.4：app → workflows → modules → core → shared，只允许向右依赖
  const backendAllowed = {
    shell: new Set(['shell', 'app', 'workflows', 'modules', 'core', 'shared']),
    app: new Set(['app', 'workflows', 'modules', 'core', 'shared']),
    workflows: new Set(['workflows', 'modules', 'core', 'shared']),
    modules: new Set(['modules', 'core', 'shared']),
    core: new Set(['core', 'shared']),
    shared: new Set(['shared']),
    other: new Set(['shell', 'app', 'workflows', 'modules', 'core', 'shared', 'other']),
  }
  const webAllowed = {
    app: new Set(['app', 'pages', 'features', 'shared']),
    pages: new Set(['pages', 'features', 'shared']),
    features: new Set(['features', 'shared']),
    shared: new Set(['shared']),
    other: new Set(['app', 'pages', 'features', 'shared', 'other']),
  }
  /**
   * 跨项目运行时导入白名单：server 与 web/src 之间的边默认必须 type-only
   * （server 用 esbuild 打包，运行时导入会把前端模块打进产物；反向则把后端依赖拖进浏览器包）。
   * 确有意共享的运行时模块必须在此登记并写明理由，条目形如 'server/shared/xxx.ts'。
   */
  const crossProjectRuntimeAllowlist = new Set([])

  for (const edge of imports) {
    if (checkEdgeFull && edge.from.startsWith('server/') && edge.to.startsWith('server/')) {
      const from = backendLayer(edge.from),
        to = backendLayer(edge.to)
      if (!backendAllowed[from]?.has(to))
        report('ARCH001', edge.from, edge.line, `${from} must not import ${to}: ${edge.to}`)
      // 产品线边界（蓝图 §2.4）：cloudflare/saas 与 cloudflare/tunnel 互不引用，共享能力走底座（D2）
      const fromProduct = edge.from.match(/^server\/modules\/cloudflare\/(saas|tunnel)\//)?.[1]
      const toProduct = edge.to.match(/^server\/modules\/cloudflare\/(saas|tunnel)\//)?.[1]
      if (fromProduct && toProduct && fromProduct !== toProduct)
        report('ARCH002', edge.from, edge.line, `cloudflare/${fromProduct} must not import cloudflare/${toProduct}`)
      const fromWorkflow = edge.from.match(/^server\/workflows\/([^/]+)/)?.[1]
      const toWorkflow = edge.to.match(/^server\/workflows\/([^/]+)/)?.[1]
      // derived-records 是跨产品线共享的 DNS 写入口（D3），允许被其他用例依赖
      if (fromWorkflow && toWorkflow && fromWorkflow !== toWorkflow && toWorkflow !== 'derived-records')
        report('ARCH003', edge.from, edge.line, `workflow ${fromWorkflow} must not import workflow ${toWorkflow}`)
    }
    if (edge.from.startsWith('web/src/') && edge.to.startsWith('web/src/')) {
      const fromFeature = edge.from.match(/^web\/src\/features\/([^/]+)/)?.[1]
      const toFeature = edge.to.match(/^web\/src\/features\/([^/]+)/)?.[1]
      if (checkEdgeFull) {
        const from = webLayer(edge.from),
          to = webLayer(edge.to)
        if (!webAllowed[from]?.has(to))
          report('ARCH004', edge.from, edge.line, `${from} must not import ${to}: ${edge.to}`)
        // ARCH005：feature 之间互不引用（同层切片禁止互相依赖，共享能力下沉 web/src/shared 或各自维护）
        if (fromFeature && toFeature && fromFeature !== toFeature)
          report(
            'ARCH005',
            edge.from,
            edge.line,
            `feature ${fromFeature} must not import feature ${toFeature}: ${edge.to} (same-layer slices must not depend on each other)`
          )
        if (edge.from.startsWith('web/src/features/auth/') && edge.to.startsWith('web/src/features/providers/'))
          report('ARCH017', edge.from, edge.line, 'auth must not own provider cache lifecycle')
        if (/\/api\//.test(edge.from) && /\/model\/(?:[^/]*-)?store\.ts$/.test(edge.to))
          report('ARCH018', edge.from, edge.line, 'business API must not import a store')
        // ARCH019：features 层**之外**的消费者（pages / app / shared）一律走目标 feature 的 index.ts。
        // 该判定不再覆盖 feature → feature：那正是 ARCH005 的职责，两条规则重叠会让「按提示改成 barrel」被另一条拒绝。
        if (!fromFeature && toFeature && edge.to !== `web/src/features/${toFeature}/index.ts`)
          report('ARCH019', edge.from, edge.line, `external feature consumers must use ${toFeature}/index.ts`)
      }
    }
    if (checkEdgeAlways) {
      const ownDir = edge.from.match(/^(web\/src\/shared\/ui\/[^/]+)\//)?.[1]
      if (ownDir && edge.to === `${ownDir}/index.ts`)
        report('ARCH006', edge.from, edge.line, 'shared UI must not import its own barrel')
      // ARCH032：跨项目（server ↔ web/src）运行时导入必须 type-only
      const crossProject =
        (edge.from.startsWith('server/') && edge.to.startsWith('web/src/')) ||
        (edge.from.startsWith('web/src/') && edge.to.startsWith('server/'))
      if (crossProject && !edge.typeOnly && !crossProjectRuntimeAllowlist.has(edge.to))
        report(
          'ARCH032',
          edge.from,
          edge.line,
          `server and web/src must not import each other at runtime (type-only required): ${edge.to}`
        )
    }
  }
}

// Runtime cycles (type-only edges do not count)
if (checkCycles) {
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
}

for (const file of sourceFiles) {
  const code = read(file)
  if (checkFileNaming) {
    if (
      file.startsWith('server/') &&
      !file.endsWith('.d.ts') &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\.ts$/.test(path.basename(file))
    )
      report('ARCH008', file, 1, 'backend TypeScript filename must be kebab-case')
    if (file.endsWith('.vue') && !/^[A-Z][A-Za-z0-9]*\.vue$/.test(path.basename(file)))
      report('ARCH009', file, 1, 'Vue filename must be PascalCase')
  }
  if (checkFileRuntimeRules) {
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
        'cache forwarding layers and sweeper timers are forbidden (expiry/eviction is lazy, see README.md 的「终态原则」)'
      )
  }
  if (checkPerFileFull) {
    if (/rowOperationTokens|\bclaimRow\s*\(|\breleaseRow\s*\(/.test(code))
      report('ARCH029', file, 1, 'row mutation ownership must use shared useRowBusy')
    if (file === 'server/modules/cloudflare/cloudflare-zone.handlers.ts' && /request\.body\.domain/.test(code))
      report('ARCH030', file, 1, 'Cloudflare zone create accepts name only')
  }
}

// ARCH000：Vue SFC 解析失败（在读取阶段收集，这里统一上报，保证执行范围统计与文件内容无关）
if (checkVueSfc)
  for (const vueError of vueParseErrors) report('ARCH000', vueError.file, 1, `invalid Vue SFC: ${vueError.message}`)

// ARCH033：以 ./ ../ 或别名开头却解析失败的说明符必须为 0（此前静默丢边，重命名目录后门禁仍报 ok）
if (checkUnresolved) {
  const shown = unresolvedSpecifiers.slice(0, 20)
  for (const item of shown) report('ARCH033', item.file, item.line, `unresolved import specifier: ${item.specifier}`)
  if (unresolvedSpecifiers.length > shown.length)
    report(
      'ARCH033',
      'scripts/check-architecture.mjs',
      1,
      `${unresolvedSpecifiers.length - shown.length} more unresolved import specifier(s), total ${unresolvedSpecifiers.length}`
    )
}

// ARCH034：动态 import() 实参必须是字符串字面量，否则静态图无法追踪（此前直接丢边）
if (checkDynamicImport)
  for (const item of dynamicImportArguments)
    report('ARCH034', item.file, item.line, `dynamic import() argument must be a string literal: ${item.text}`)

if (checkRouteSchema && schemaRoutes !== routeCalls)
  report('ARCH013', 'server', 1, `${routeCalls - schemaRoutes} route(s) missing schema`)

if (checkErrorCodes) {
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
  // prefixSources 声明前缀取值来自哪些调用点，下方与静态扫描结果双向对账：新增取值来源而漏登记、
  // 或调用点删除而白名单未清理都会失败（edgeone 前缀的展开值此前就整片漏登记过）。
  const errorCodeTemplateAllowlist = new Map([
    [
      '${}_provider_not_found',
      {
        // DnsPodAccess.linkedProviderId：source 为 'edgeone' | 'saas'（DnsPodLinkSource）
        expansions: ['edgeone_provider_not_found', 'saas_provider_not_found'],
        prefixSources: ['access.linkedProviderId'],
      },
    ],
    [
      '${}_dnspod_provider_missing',
      {
        // DnsPodAccess.requireLinkedProviderId：source 同上
        expansions: ['edgeone_dnspod_provider_missing', 'saas_dnspod_provider_missing'],
        prefixSources: ['access.requireLinkedProviderId'],
      },
    ],
    [
      '${}_fqdn_empty',
      {
        // DnsPodZoneCatalog.resolve：errorCodePrefix 来自调用点（saas / edgeone 两个来源）
        expansions: ['edgeone_fqdn_empty', 'saas_fqdn_empty'],
        prefixSources: ['catalog.resolve'],
      },
    ],
    [
      '${}_dnspod_zone_not_found',
      {
        // DnsPodZoneCatalog.resolve / requireExplicit：errorCodePrefix 来自调用点（saas / edgeone）
        expansions: ['edgeone_dnspod_zone_not_found', 'saas_dnspod_zone_not_found'],
        prefixSources: ['catalog.resolve', 'catalog.requireExplicit'],
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
  // 反向前缀对账：白名单登记的前缀集合必须与代码中实际出现的调用点前缀集合一致
  for (const [skeleton, entry] of errorCodeTemplateAllowlist) {
    const sources = entry.prefixSources
    if (!sources) continue
    const suffix = skeleton.replaceAll('${}', '')
    const declared = new Map()
    for (const code of entry.expansions) {
      if (!code.endsWith(suffix)) {
        report(
          'ARCH028',
          'scripts/check-architecture.mjs',
          1,
          `template ${skeleton} expansion must end with ${suffix}: ${code}`
        )
        continue
      }
      declared.set(code.slice(0, code.length - suffix.length), true)
    }
    const actual = new Map()
    for (const source of sources) {
      for (const [prefix, location] of errorCodePrefixUsages.get(source) ?? []) {
        const existing = actual.get(prefix)
        if (existing) existing.sources.add(source)
        else actual.set(prefix, { ...location, sources: new Set([source]) })
      }
    }
    for (const [prefix, location] of actual) {
      if (!declared.has(prefix))
        report(
          'ARCH028',
          location.file,
          location.line,
          `error-code prefix "${prefix}" (${[...location.sources].join(', ')}) missing from template ${skeleton} allowlist`
        )
    }
    for (const prefix of declared.keys()) {
      if (!actual.has(prefix))
        report(
          'ARCH028',
          'scripts/check-architecture.mjs',
          1,
          `stale template ${skeleton} allowlist prefix "${prefix}": no matching errorCodePrefix usage`
        )
    }
  }
  // 载体自检：前缀载体的类型名必须仍存在于扫描到的类型声明里，否则说明类型被改名/搬迁，
  // 上面的按类型判定会静默退化成「不可判」——这里让它显式失败，强制同步更新本脚本。
  for (const [sourceKey, spec] of errorCodePrefixSources) {
    for (const carrierType of spec.carrierTypes) {
      if (!declaredTypeNames.has(carrierType))
        report(
          'ARCH028',
          'scripts/check-architecture.mjs',
          1,
          `carrier type ${carrierType} of ${sourceKey} no longer exists in sources; update errorCodePrefixSources`
        )
    }
  }
}

if (checkRoutesFile)
  for (const file of backendFiles)
    if (/\bapp\.(?:get|post|put|patch|delete|head|options)\s*\(/.test(read(file)) && !file.endsWith('.routes.ts'))
      report('ARCH014', file, 1, 'Fastify route declarations belong in *.routes.ts')

if (checkBatchPresenter) {
  const forbiddenBatchJobFields = new Set(['items', 'execution_owner', 'execution_token', 'lease_until'])
  for (const file of backendFiles.filter((candidate) => candidate.startsWith('server/workflows/'))) {
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

if (checkHandlerShape) {
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
}

if (checkWorkflowClass) {
  for (const file of backendFiles.filter((candidate) => candidate.endsWith('.workflow.ts'))) {
    const code = read(file)
    for (const match of code.matchAll(/export\s+class\s+(\w+)/g)) {
      if (!match[1].endsWith('Workflow'))
        report('ARCH023', file, lineAt(code, match.index), `workflow class must end with Workflow: ${match[1]}`)
    }
  }
}

if (checkAppContext) {
  for (const file of backendFiles) {
    const code = read(file)
    for (const match of code.matchAll(/\b(?:request\.server|app)\.ctx\.([A-Za-z_$][\w$]*)/g)) {
      if (!['config', 'platform', 'modules', 'workflows'].includes(match[1]))
        report('ARCH024', file, lineAt(code, match.index), `flat AppContext access is forbidden: ctx.${match[1]}`)
    }
  }
}

if (checkLegacyRequestParse) {
  for (const file of backendFiles.filter((candidate) => candidate.endsWith('.handlers.ts'))) {
    if (/request-parse\.js/.test(read(file)))
      report('ARCH025', file, 1, 'handlers must not import the legacy request-parse helper')
  }
}

// ARCH015：真正枚举目录（此前由 walk(...).map(dirname) 推导候选，而 walk 只返回文件，判定恒为假）
if (checkEmptyDirs) {
  for (const dir of ['server', 'web/src']) {
    for (const candidate of walkDirectories(dir)) {
      if (fs.readdirSync(absolute(candidate)).length === 0) report('ARCH015', candidate, 1, 'empty directory')
    }
  }
}

// ARCH035：布局前缀目录存在、各层有源文件、别名映射可用（防止「目录/别名改了，门禁照报 ok」）
if (checkLayout) {
  const layoutLayers = new Map([
    ['server', ['app', 'workflows', 'modules', 'core', 'shared', 'types']],
    ['web/src', ['app', 'pages', 'features', 'shared']],
  ])
  for (const [dir, layers] of layoutLayers) {
    if (!exists(dir)) report('ARCH035', dir, 1, 'layout root directory is missing')
    for (const layer of layers) {
      const layerDir = `${dir}/${layer}`
      if (!exists(layerDir)) report('ARCH035', layerDir, 1, 'layout layer directory is missing')
      else if (sourceFiles.filter((file) => file.startsWith(`${layerDir}/`)).length === 0)
        report('ARCH035', layerDir, 1, 'layout layer must contain at least one source file')
    }
  }
  if (aliasConfigError) report('ARCH035', aliasConfigPath, 1, aliasConfigError)
  for (const alias of aliases) {
    if (alias.dir === '' || !exists(alias.dir))
      report('ARCH035', aliasConfigPath, 1, `alias ${alias.prefix}* points to a missing directory: ${alias.dir}`)
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
  'server/use-cases',
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
if (checkLegacyPaths)
  for (const legacy of forbiddenLegacy) if (exists(legacy)) report('ARCH016', legacy, 1, 'legacy path must be removed')

// ARCH099：规则清单自检——全量模式下每条声明过的规则都必须被执行过，避免清单与实际检查脱节
if (finalMode) {
  for (const id of ruleScopes.keys()) {
    if (!executedRules.has(id))
      report('ARCH099', 'scripts/check-architecture.mjs', 1, `rule declared but never executed: ${id}`)
  }
  if (executedRules.size !== ruleScopes.size)
    report(
      'ARCH099',
      'scripts/check-architecture.mjs',
      1,
      `executed rule coverage ${executedRules.size}/${ruleScopes.size} in final mode`
    )
}

const scopeLine = `rules=${executedRules.size}/${ruleScopes.size} final=${finalMode ? 1 : 0}`
if (errors.length) {
  console.error(`Architecture check failed (${errors.length}, ${scopeLine}):`)
  for (const error of errors.sort()) console.error(error)
  process.exit(1)
}
console.log(
  `architecture=ok files=${sourceFiles.length} tests=${testFiles.length} imports=${imports.length} routes=${routeCalls} ${scopeLine}`
)
if (fastMode)
  console.log(
    `architecture-note=fast mode skips ${[...ruleScopes.values()].filter((scope) => scope === 'full').length} full-only rule(s); run npm run arch:final for the complete gate`
  )
