import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 迁移自 scripts/isolated-maintenance-contract-probe.ts（部署契约 + 依赖审计）。
 *
 * npm audit 用例默认不执行：它要打外部注册表，本机与 CI 的镜像源/联网状况会让结果不可复现。
 * 需要复审时显式开：DNS_PRO_RUN_NPM_AUDIT=1 npx vitest run scripts/maintenance-contract.test.ts
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8')

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

/**
 * 取一条 Dockerfile 指令（含行尾 `\` 续行的后续行）；指令不存在直接抛错。
 * 断言必须落在单条指令窗口内：全文匹配会让 node 与 /api/health 分处两条不相干的指令也算命中。
 */
function dockerInstruction(name: string): string {
  const lines = dockerfile.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`${name} `) || line === name)
  if (start === -1) throw new Error(`Dockerfile 缺少指令：${name}`)
  const instruction: string[] = []
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    instruction.push(line)
    if (!line.trimEnd().endsWith('\\')) break
  }
  return instruction.join('\n')
}

describe('Dockerfile 健康检查契约', () => {
  it('健康检查必须用 node 请求 /api/health，不得依赖镜像内不存在的 curl/wget', () => {
    const healthcheck = dockerInstruction('HEALTHCHECK')

    // node 与 /api/health 必须在同一条 HEALTHCHECK 指令里（跨指令命中不算数）
    expect(healthcheck).toMatch(/\bnode\b[\s\S]*\/api\/health/)
    // 同一条指令里不得出现镜像内没有的 curl/wget
    expect(healthcheck).not.toMatch(/\b(curl|wget)\b/)
  })
})

describe('npm audit 注册表行为', () => {
  it.skipIf(process.env.DNS_PRO_RUN_NPM_AUDIT !== '1')(
    '依赖漏洞总数为 0（审计端点不可用时换官方源复审）',
    () => {
      // 本机 registry 常配成 npmmirror 这类不实现 security advisories 的镜像（404），
      // 拿不到数据既不能当「零漏洞」也不能当仓库缺陷：换官方源复审一次，两处都不可用才算环境故障
      const configured = audit()
      const verified = vulnerabilityTotal(configured) === null ? audit('https://registry.npmjs.org') : configured
      const total = vulnerabilityTotal(verified)
      expect(total).not.toBeNull()
      expect(total).toBe(0)
      expect(verified.status).toBe(0)
    },
    120_000
  )
})
