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

describe('Dockerfile 健康检查契约', () => {
  it('健康检查必须用 node 请求 /api/health，不得依赖镜像内不存在的 curl/wget', () => {
    expect(dockerfile).toMatch(/^HEALTHCHECK\s/m)
    expect(dockerfile).toMatch(/node[\s\S]*\/api\/health/)
    expect(dockerfile).not.toMatch(/HEALTHCHECK[\s\S]{0,300}\b(curl|wget)\b/)
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
