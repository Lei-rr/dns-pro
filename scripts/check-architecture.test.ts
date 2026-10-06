import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * 架构守卫（scripts/check-architecture.mjs）的规则测试。
 *
 * 手法：在系统临时目录里搭一份最小工作区（含双端布局、tsconfig 别名、错误码映射与模板白名单），
 * 用真实脚本（child_process）跑门禁，再按规则号断言输出——这样测的是守卫本身的判定口径，
 * 而不是它的实现细节。工作区在 afterAll 统一删除，不进版本库、不留残留。
 *
 * 注意：基础样例是「干净」的（无任何违规），因此每条负样本都能明确对应到被钉住的规则。
 */
const checkerPath = fileURLToPath(new URL('./check-architecture.mjs', import.meta.url))

const workspaces: string[] = []
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true })
})

interface FixtureOptions {
  /** 不创建的布局层目录（ARCH035 负样本） */
  omitLayers?: string[]
  /** @server/* 别名指向的目标（ARCH035 别名负样本） */
  aliasTarget?: string
}

interface Fixture {
  dir: string
  write: (relPath: string, content: string) => void
  mkdir: (relPath: string) => void
}

/** 各布局层至少一个源文件：ARCH035 要求层目录存在且非空 */
const LAYOUT_FILES: Record<string, string> = {
  'server/app/index.ts': 'export const appLayer = 1',
  'server/workflows/index.ts': 'export const workflowsLayer = 1',
  'server/modules/index.ts': 'export const modulesLayer = 1',
  'server/core/index.ts': 'export const coreLayer = 1',
  'server/shared/index.ts': 'export const sharedLayer = 1',
  'web/src/app/index.ts': 'export const appLayer = 1',
  'web/src/pages/index.ts': 'export const pagesLayer = 1',
  'web/src/features/index.ts': 'export const featuresLayer = 1',
  'web/src/shared/index.ts': 'export const sharedLayer = 1',
}

/**
 * 前缀载体与模板最小样张：让 ARCH028 的白名单双向对账（模板骨架、展开码、前缀取值来源）
 * 在基础样例里就是自洽的，这样任何一条 ARCH028 负样本都能唯一定位。
 */
const ERROR_CODE_PAYLOAD = `
export class DemoFlow {
  constructor(
    private readonly catalog: DnsZoneCatalogPort,
    private readonly access: LinkedDnsAccountPort
  ) {}

  async resolveSaas(providerId: string, fqdn: string): Promise<string> {
    return this.catalog.resolve(providerId, fqdn, 'saas')
  }

  async resolveEdgeOne(providerId: string, fqdn: string): Promise<string> {
    return this.catalog.resolve(providerId, fqdn, 'edgeone')
  }

  async explicitSaas(providerId: string, zone: string): Promise<string> {
    return this.catalog.requireExplicit(providerId, zone, 'saas')
  }

  async explicitEdgeOne(providerId: string, zone: string): Promise<string> {
    return this.catalog.requireExplicit(providerId, zone, 'edgeone')
  }

  async linkSaas(providerId: string): Promise<string> {
    return this.access.linkedProviderId(providerId, 'saas', 'SaaS')
  }

  async linkEdgeOne(providerId: string): Promise<string> {
    return this.access.linkedProviderId(providerId, 'edgeone', 'EdgeOne')
  }

  async requireSaas(providerId: string): Promise<string> {
    return this.access.requireLinkedProviderId(providerId, 'saas', 'SaaS')
  }

  async requireEdgeOne(providerId: string): Promise<string> {
    return this.access.requireLinkedProviderId(providerId, 'edgeone', 'EdgeOne')
  }

  failFqdn(prefix: string): never {
    throw new ApiError(\`\${prefix}_fqdn_empty\`, 'empty', 422)
  }

  failZone(prefix: string): never {
    throw new ApiError(\`\${prefix}_dnspod_zone_not_found\`, 'missing zone', 422)
  }

  failProvider(prefix: string): never {
    throw new ApiError(\`\${prefix}_provider_not_found\`, 'missing provider', 422)
  }

  failLinked(prefix: string): never {
    throw new ApiError(\`\${prefix}_dnspod_provider_missing\`, 'missing link', 422)
  }
}
`

function createFixture(options: FixtureOptions = {}): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'dns-pro-arch-'))
  workspaces.push(dir)
  const write = (relPath: string, content: string) => {
    const target = path.join(dir, relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`)
  }
  const mkdir = (relPath: string) => mkdirSync(path.join(dir, relPath), { recursive: true })

  write(
    'web/tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['./src/*'], '@server/*': [options.aliasTarget ?? '../server/*'] },
      },
    })
  )
  for (const [relPath, content] of Object.entries(LAYOUT_FILES)) {
    const layer = relPath
      .split('/')
      .slice(0, relPath.startsWith('web/') ? 3 : 2)
      .join('/')
    if (options.omitLayers?.includes(layer)) continue
    write(relPath, content)
  }
  write('server/core/cache/memory-cache.ts', 'export const memoryCache = new Map<string, unknown>()')
  write('server/core/cache/provider-cache.ts', 'export const providerCache = new Map<string, unknown>()')
  write(
    'server/core/contracts/architecture-carriers.ts',
    [
      'export class DnsPodZoneCatalog {}',
      'export class DnsPodAccess {}',
      'export interface DnsZoneCatalogPort {}',
      'export interface LinkedDnsAccountPort {}',
    ].join('\n')
  )
  write(
    'server/modules/demo/demo-errors.ts',
    [
      "import type { DnsZoneCatalogPort, LinkedDnsAccountPort } from '../../core/contracts/architecture-carriers.js'",
      ERROR_CODE_PAYLOAD,
    ].join('\n')
  )
  write(
    'server/core/http/error-messages.ts',
    [
      'export const errorMessages: Record<string, string> = {',
      "  saas_fqdn_empty: 'SaaS 域名为空',",
      "  edgeone_fqdn_empty: 'EdgeOne 域名为空',",
      "  saas_dnspod_zone_not_found: '未找到 DNSPod 域名',",
      "  edgeone_dnspod_zone_not_found: '未找到 DNSPod 域名',",
      "  saas_provider_not_found: '未找到服务商',",
      "  edgeone_provider_not_found: '未找到服务商',",
      "  saas_dnspod_provider_missing: '缺少 DNSPod 关联',",
      "  edgeone_dnspod_provider_missing: '缺少 DNSPod 关联',",
      '}',
    ].join('\n')
  )
  return { dir, write, mkdir }
}

interface CheckerResult {
  status: number
  output: string
}

function runChecker(dir: string, args: string[] = []): CheckerResult {
  try {
    const stdout = execFileSync(process.execPath, [checkerPath, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, output: stdout }
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string }
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

const issuesOf = (output: string, rule: string) => output.split('\n').filter((line) => line.startsWith(`${rule} `))

const allRuleIds = (output: string) => [...new Set(output.matchAll(/(ARCH\d{3}) /g))].map((match) => match[1])

interface ViolationCase {
  rule: string
  files?: Record<string, string>
  dirs?: string[]
}

/** 每条规则一个违规样本：既钉住规则本身，也钉住「规则被真正执行」这件事 */
const VIOLATION_CASES: ViolationCase[] = [
  {
    rule: 'ARCH000',
    files: { 'web/src/shared/ui/card/TmpArch000Broken.vue': '<template><div></template>' },
  },
  {
    rule: 'ARCH001',
    files: {
      'server/shared/tmp-arch001.ts': "import { demo } from '../modules/demo/demo.js'",
      'server/modules/demo/demo.ts': 'export const demo = 1',
    },
  },
  {
    rule: 'ARCH002',
    files: {
      'server/modules/cloudflare/saas/tmp-arch002.ts': "import { tunnelPath } from '../tunnel/tunnel-path.js'",
      'server/modules/cloudflare/tunnel/tunnel-path.ts': 'export const tunnelPath = 1',
    },
  },
  {
    rule: 'ARCH003',
    files: {
      'server/workflows/one/tmp-arch003.ts': "import { two } from '../two/two.js'",
      'server/workflows/two/two.ts': 'export const two = 1',
    },
  },
  {
    rule: 'ARCH004',
    files: {
      'web/src/shared/tmp-arch004.ts': "import { demo } from '@/features/demo/demo.js'",
      'web/src/features/demo/demo.ts': 'export const demo = 1',
    },
  },
  {
    rule: 'ARCH005',
    files: {
      'web/src/features/one/tmp-arch005.ts': "import { two } from '@/features/two/two.js'",
      'web/src/features/two/two.ts': 'export const two = 1',
    },
  },
  {
    rule: 'ARCH006',
    files: {
      'web/src/shared/ui/card/tmp-arch006.ts': "import { card } from './index.js'",
      'web/src/shared/ui/card/index.ts': 'export const card = 1',
    },
  },
  {
    rule: 'ARCH007',
    files: {
      'server/shared/tmp-arch007-a.ts': "import { b } from './tmp-arch007-b.js'\nexport const a = b + 1",
      'server/shared/tmp-arch007-b.ts': "import { a } from './tmp-arch007-a.js'\nexport const b = a + 1",
    },
  },
  { rule: 'ARCH008', files: { 'server/shared/TmpArch008BadName.ts': 'export const bad = 1' } },
  {
    rule: 'ARCH009',
    files: { 'web/src/shared/ui/card/tmp-arch009-bad-name.vue': '<template><div /></template>' },
  },
  { rule: 'ARCH010', files: { 'server/shared/tmp-arch010.ts': "export const tmpArch010 = 'DomainEvent'" } },
  {
    rule: 'ARCH011',
    files: { 'server/shared/tmp-arch011.ts': 'export const tmpArch011 = new JsonStore<number>()' },
  },
  {
    rule: 'ARCH012',
    files: {
      'server/shared/tmp-arch012.ts': 'export const tmpArch012 = (): void => {\n  setInterval(() => {}, 1000)\n}',
    },
  },
  {
    rule: 'ARCH013',
    files: {
      'server/shared/tmp-arch013.routes.ts':
        "export function tmpArch013Register(app: { get(path: string, options: unknown, handler: unknown): void }, handler: unknown): void {\n  app.get('/arch013-missing-schema', { handler }, handler)\n}",
    },
  },
  {
    rule: 'ARCH014',
    files: {
      'server/shared/tmp-arch014.ts':
        "export function tmpArch014Register(app: { get(path: string, options: unknown, handler: unknown): void }): void {\n  app.get('/arch014', { schema: {} }, () => undefined)\n}",
    },
  },
  { rule: 'ARCH015', dirs: ['server/shared/tmp-arch015-empty'] },
  { rule: 'ARCH016', files: { 'server/lib/index.ts': 'export const legacy = 1' } },
  {
    rule: 'ARCH017',
    files: {
      'web/src/features/auth/tmp-arch017.ts': "import { demo } from '@/features/providers/demo.js'",
      'web/src/features/providers/demo.ts': 'export const demo = 1',
    },
  },
  {
    rule: 'ARCH018',
    files: {
      'web/src/features/demo/api/tmp-arch018.ts': "import { store } from '../model/tmp-arch018-store.js'",
      'web/src/features/demo/model/tmp-arch018-store.ts': 'export const store = 1',
    },
  },
  {
    rule: 'ARCH019',
    files: {
      'web/src/pages/tmp-arch019.ts': "import { demo } from '@/features/demo/deep/demo.js'",
      'web/src/features/demo/deep/demo.ts': 'export const demo = 1',
    },
  },
  {
    rule: 'ARCH021',
    files: {
      'server/modules/demo/tmp-arch021.handlers.ts': 'export async function tmpArch021WrongName(): Promise<void> {}',
    },
  },
  {
    rule: 'ARCH022',
    files: {
      'server/modules/demo/tmp-arch022.handlers.ts':
        'export async function tmpArch022Handler(): Promise<void> {\n  bodyRecord()\n}',
    },
  },
  {
    rule: 'ARCH023',
    files: { 'server/workflows/demo/tmp-arch023.workflow.ts': 'export class TmpArch023WrongName {}' },
  },
  {
    rule: 'ARCH024',
    files: {
      'server/shared/tmp-arch024.ts':
        'export const tmpArch024 = (app: { ctx: Record<string, unknown> }): unknown => app.ctx.tmpThing',
    },
  },
  {
    rule: 'ARCH025',
    files: {
      'server/shared/request-parse.ts': 'export const parseRequest = (): void => undefined',
      'server/modules/demo/tmp-arch025.handlers.ts':
        "import { parseRequest } from '../../shared/request-parse.js'\nexport async function tmpArch025Handler(): Promise<void> {\n  parseRequest()\n}",
    },
  },
  {
    rule: 'ARCH026',
    files: {
      'server/modules/demo/tmp-arch026.handlers.ts':
        'export async function tmpArch026Handler(request: FastifyRequest): Promise<void> {}',
    },
  },
  {
    rule: 'ARCH027',
    files: {
      'server/modules/demo/tmp-arch027.handlers.ts':
        'export async function tmpArch027Handler(request: { server: { ctx: { workflows: unknown } } }): Promise<void> {\n  void request.server.ctx.workflows\n}',
    },
  },
  {
    rule: 'ARCH028',
    files: {
      'server/shared/tmp-arch028.ts': [
        "import type { DnsZoneCatalogPort } from '../core/contracts/architecture-carriers.js'",
        'export class TmpArch028 {',
        '  constructor(private readonly catalog: DnsZoneCatalogPort) {}',
        '  async run(providerId: string, fqdn: string, prefix: string): Promise<string> {',
        '    return this.catalog.resolve(providerId, fqdn, prefix)',
        '  }',
        '}',
      ].join('\n'),
    },
  },
  {
    rule: 'ARCH029',
    files: { 'web/src/shared/tmp-arch029.ts': "export const tmpArch029 = (): void => {\n  claimRow('x')\n}" },
  },
  {
    rule: 'ARCH030',
    files: {
      'server/modules/cloudflare/cloudflare-zone.handlers.ts':
        'export async function tmpArch030Handler(request: { body: { domain: string } }): Promise<void> {\n  void request.body.domain\n}',
    },
  },
  {
    rule: 'ARCH031',
    files: {
      'server/workflows/demo/tmp-arch031.ts':
        'interface JobRecord {\n  items: unknown[]\n  status: string\n}\nexport function presentTmpArch031(job: JobRecord): unknown {\n  return job.items\n}',
    },
  },
  {
    rule: 'ARCH032',
    files: {
      'web/src/shared/tmp-arch032.ts':
        "import { toAsciiFqdn } from '@server/shared/values.js'\nexport const tmpArch032 = (value: string): string => toAsciiFqdn(value)",
      'server/shared/values.ts': 'export const toAsciiFqdn = (value: string): string => value',
    },
  },
  {
    rule: 'ARCH033',
    files: { 'web/src/shared/tmp-arch033.ts': "import type { Missing } from '@/features/nope/missing.js'" },
  },
  {
    rule: 'ARCH034',
    files: {
      'web/src/shared/tmp-arch034.ts':
        'export async function tmpArch034(name: string): Promise<unknown> {\n  return import(name)\n}',
    },
  },
]

describe('架构守卫：基础样例', () => {
  it('干净的布局样例应通过，且不触发任何规则', () => {
    const fixture = createFixture()
    const result = runChecker(fixture.dir)
    expect(result.output).toContain('architecture=ok')
    expect(result.status).toBe(0)
    expect(allRuleIds(result.output)).toEqual([])
  })
})

describe('架构守卫：执行范围披露与清单自检', () => {
  it('默认模式跑满全部规则，--fast 少跑并披露 final=0 与执行条数', () => {
    const fixture = createFixture()
    const full = runChecker(fixture.dir)
    const fast = runChecker(fixture.dir, ['--fast'])

    const fullScope = /rules=(\d+)\/(\d+) final=(\d)/.exec(full.output)
    const fastScope = /rules=(\d+)\/(\d+) final=(\d)/.exec(fast.output)
    expect(fullScope).not.toBeNull()
    expect(fastScope).not.toBeNull()
    expect(Number(fullScope?.[1])).toBe(Number(fullScope?.[2]))
    expect(Number(fullScope?.[3])).toBe(1)
    expect(Number(fastScope?.[3])).toBe(0)
    expect(Number(fastScope?.[1])).toBeLessThan(Number(fastScope?.[2]))
    expect(fast.output).toContain('architecture-note=fast mode skips')
  })

  it('全量模式下规则清单自检（ARCH099）不得报未执行规则', () => {
    const fixture = createFixture()
    const result = runChecker(fixture.dir)
    expect(issuesOf(result.output, 'ARCH099')).toEqual([])
  })

  it('每条规则都能被违规样本触发（逐条负样本，单次全量运行）', () => {
    const fixture = createFixture()
    for (const testCase of VIOLATION_CASES) {
      for (const [relPath, content] of Object.entries(testCase.files ?? {})) fixture.write(relPath, content)
      for (const relPath of testCase.dirs ?? []) fixture.mkdir(relPath)
    }
    const result = runChecker(fixture.dir)
    const missing = VIOLATION_CASES.filter((testCase) => issuesOf(result.output, testCase.rule).length === 0)
    expect(result.status).toBe(1)
    expect(missing.map((testCase) => testCase.rule)).toEqual([])
  })
})

describe('架构守卫：空目录与解析兜底（ARCH015/033/034/035）', () => {
  it('ARCH015：空目录必须报错，含文件的目录不报', () => {
    const fixture = createFixture()
    fixture.mkdir('server/shared/tmp-empty-one')
    fixture.mkdir('web/src/features/tmp-empty-two')
    const result = runChecker(fixture.dir)
    const emptyDirs = issuesOf(result.output, 'ARCH015')
    expect(emptyDirs).toHaveLength(2)
    expect(emptyDirs.some((line) => line.includes('server/shared/tmp-empty-one:1 empty directory'))).toBe(true)
    expect(emptyDirs.some((line) => line.includes('web/src/features/tmp-empty-two:1 empty directory'))).toBe(true)

    fixture.write('web/src/features/tmp-empty-two/kept.ts', 'export const kept = 1')
    expect(issuesOf(runChecker(fixture.dir).output, 'ARCH015')).toHaveLength(1)
  })

  it('ARCH033：别名与相对路径解析失败必须报错，可解析时静默通过', () => {
    const fixture = createFixture()
    fixture.write('web/src/shared/tmp-missing.ts', "import type { Missing } from '@/features/nope/missing.js'")
    fixture.write(
      'web/src/shared/tmp-missing-relative.ts',
      "import type { Missing } from '../../server/nope/missing.js'"
    )
    const result = runChecker(fixture.dir)
    const unresolved = issuesOf(result.output, 'ARCH033')
    expect(unresolved).toHaveLength(2)
    expect(result.output).toContain('unresolved import specifier: @/features/nope/missing.js')

    fixture.write('web/src/shared/tmp-ok-alias.ts', "export { sharedLayer } from './index.js'")
    const resolved = runChecker(fixture.dir)
    expect(issuesOf(resolved.output, 'ARCH033')).toHaveLength(2)
  })

  it('ARCH034：动态 import() 实参非字面量必须报错', () => {
    const fixture = createFixture()
    fixture.write(
      'web/src/shared/tmp-dynamic.ts',
      'export async function load(name: string): Promise<unknown> {\n  return import(name)\n}'
    )
    const result = runChecker(fixture.dir)
    expect(issuesOf(result.output, 'ARCH034')).toHaveLength(1)
    expect(result.output).toContain('dynamic import() argument must be a string literal')
  })

  it('ARCH035：布局层目录缺失、层内无源文件、别名指向不存在目录都必须报错', () => {
    const missingLayer = createFixture({ omitLayers: ['web/src/pages'] })
    expect(runChecker(missingLayer.dir).output).toContain('ARCH035 web/src/pages:1 layout layer directory is missing')

    const emptyLayer = createFixture({ omitLayers: ['web/src/pages'] })
    emptyLayer.mkdir('web/src/pages') // 目录存在但没有任何源文件
    expect(runChecker(emptyLayer.dir).output).toContain(
      'ARCH035 web/src/pages:1 layout layer must contain at least one source file'
    )

    const brokenAlias = createFixture({ aliasTarget: '../server-nope/*' })
    expect(runChecker(brokenAlias.dir).output).toContain('alias @server/* points to a missing directory')
  })
})

describe('架构守卫：分层与类型擦除口径', () => {
  it('ARCH032：跨项目运行时导入必须报错，type-only 不报', () => {
    const fixture = createFixture()
    fixture.write('server/shared/values.ts', 'export const toAsciiFqdn = (value: string): string => value')
    fixture.write(
      'web/src/shared/tmp-runtime.ts',
      "import { toAsciiFqdn } from '@server/shared/values.js'\nexport const normalized = (value: string): string => toAsciiFqdn(value)"
    )
    fixture.write(
      'web/src/shared/tmp-type-only.ts',
      "import type { ProviderType } from '@server/core/providers/provider.types.js'\nexport type TmpProviderType = ProviderType"
    )
    fixture.write('server/core/providers/provider.types.ts', "export type ProviderType = 'cloudflare'")
    fixture.write(
      'server/shared/tmp-server-side.ts',
      "import { sharedLayer } from '../../web/src/shared/index.js'\nexport const reuse = sharedLayer"
    )
    const result = runChecker(fixture.dir)
    const crossProject = issuesOf(result.output, 'ARCH032')
    expect(crossProject).toHaveLength(2)
    expect(crossProject.some((line) => line.includes('web/src/shared/tmp-runtime.ts'))).toBe(true)
    expect(crossProject.some((line) => line.includes('server/shared/tmp-server-side.ts'))).toBe(true)
    expect(crossProject.some((line) => line.includes('tmp-type-only.ts'))).toBe(false)
  })

  it('ARCH005 与 ARCH019 语义互补：同层互引归 ARCH005，外部消费者走 barrel 归 ARCH019', () => {
    const fixture = createFixture()
    fixture.write('web/src/features/two/two.ts', 'export const two = 1')
    fixture.write('web/src/features/two/index.ts', "export { two } from './two.js'")
    fixture.write('web/src/features/one/tmp-deep.ts', "import { two } from '@/features/two/two.js'")
    fixture.write('web/src/features/one/tmp-barrel.ts', "import { two } from '@/features/two'")
    fixture.write('web/src/pages/tmp-page-deep.ts', "import { two } from '@/features/two/two.js'")
    fixture.write('web/src/pages/tmp-page-barrel.ts', "import { two } from '@/features/two'")
    const result = runChecker(fixture.dir)

    const arch005 = issuesOf(result.output, 'ARCH005')
    const arch019 = issuesOf(result.output, 'ARCH019')
    // 同层互引（深层与 barrel 都算）只由 ARCH005 负责，不再出现「改成 barrel 又被拒」的矛盾提示
    expect(arch005).toHaveLength(2)
    expect(arch005.every((line) => line.includes('web/src/features/one/'))).toBe(true)
    // features 层之外的消费者只由 ARCH019 负责：深层导入报错，barrel 通过
    expect(arch019).toHaveLength(1)
    expect(arch019[0]).toContain('web/src/pages/tmp-page-deep.ts')
    expect(arch019[0]).toContain('must use two/index.ts')
  })

  it('ARCH007：内联 type 导入不算运行时边，混合导入仍算', () => {
    const fixture = createFixture()
    fixture.write(
      'server/shared/tmp-cycle-a.ts',
      "import { type ProbeB } from './tmp-cycle-b.js'\nexport interface ProbeA {\n  b: ProbeB\n}"
    )
    fixture.write(
      'server/shared/tmp-cycle-b.ts',
      "import { type ProbeA } from './tmp-cycle-a.js'\nexport interface ProbeB {\n  a: ProbeA\n}"
    )
    expect(issuesOf(runChecker(fixture.dir).output, 'ARCH007')).toEqual([])

    fixture.write(
      'server/shared/tmp-cycle-a.ts',
      "import { type ProbeB, probeValue } from './tmp-cycle-b.js'\nexport interface ProbeA {\n  b: ProbeB\n  v: number\n}\nexport const probeAValue = probeValue + 1"
    )
    fixture.write(
      'server/shared/tmp-cycle-b.ts',
      "import { probeAValue } from './tmp-cycle-a.js'\nexport interface ProbeB {\n  a: unknown\n}\nexport const probeValue = probeAValue + 1"
    )
    expect(issuesOf(runChecker(fixture.dir).output, 'ARCH007')).toHaveLength(1)
  })
})

describe('架构守卫：静态判定精度（ARCH013/ARCH028 正负样本）', () => {
  it('ARCH013：路由选项抽成变量（含 as const 与 spread）仍算 schema，缺 schema 必报', () => {
    const fixture = createFixture()
    fixture.write(
      'server/shared/tmp-schema.routes.ts',
      [
        'const responseSchema = { schema: { response: {} } } as const',
        'const base = { handler: () => undefined }',
        'export function register(app: { get(path: string, options: unknown, handler: unknown): void }): void {',
        "  app.get('/inline', { schema: { response: {} } }, () => undefined)",
        "  app.get('/variable', responseSchema, () => undefined)",
        "  app.get('/spread', { ...base, schema: { response: {} } }, () => undefined)",
        "  app.get('/missing', { ...base }, () => undefined)",
        '}',
      ].join('\n')
    )
    const result = runChecker(fixture.dir)
    // 4 条路由中只有 /missing 缺 schema
    expect(issuesOf(result.output, 'ARCH013')).toHaveLength(1)
    expect(result.output).toContain('1 route(s) missing schema')
  })

  it('ARCH028：合法布尔第三参放行，载体变量前缀与不可判接收者变量前缀必须报错', () => {
    const fixture = createFixture()
    fixture.write(
      'server/shared/tmp-prefix.ts',
      [
        "import type { DnsZoneCatalogPort } from '../core/contracts/architecture-carriers.js'",
        'declare const cloudflareZoneCatalog: { resolve(providerId: string, fqdn: string, refresh?: boolean): Promise<unknown> }',
        'export class TmpProbePrefix {',
        '  constructor(private readonly catalog: DnsZoneCatalogPort) {}',
        '  async literalPrefix(providerId: string, fqdn: string): Promise<string> {',
        "    return this.catalog.resolve(providerId, fqdn, 'saas')",
        '  }',
        '  async legalBoolean(providerId: string, fqdn: string): Promise<unknown> {',
        '    return cloudflareZoneCatalog.resolve(providerId, fqdn, true)',
        '  }',
        '  async variablePrefix(providerId: string, fqdn: string, prefix: string): Promise<string> {',
        '    return this.catalog.resolve(providerId, fqdn, prefix)',
        '  }',
        '}',
        'export async function tmpProbeUntyped(catalog, providerId: string, fqdn: string, prefix: string): Promise<unknown> {',
        '  return catalog.resolve(providerId, fqdn, prefix)',
        '}',
      ].join('\n')
    )
    const result = runChecker(fixture.dir)
    const prefixIssues = issuesOf(result.output, 'ARCH028').filter((line) =>
      line.includes('errorCodePrefix must be a string literal')
    )
    // 期望恰好 2 条：载体的变量前缀 + 不可判接收者的变量前缀；布尔第三参与字面量都不报
    expect(prefixIssues).toHaveLength(2)
    expect(prefixIssues.some((line) => line.includes('catalog.resolve'))).toBe(true)
  })
})
