import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * 测试临时目录清理：被测代码与测试都用 tmpdir + mkdtemp 建数据目录，
 * 单个用例内清理会掩盖失败现场，全部不清理又会持续堆积。
 *
 * 做法是「延后一轮清理」，而不是本轮结束时立刻删：
 * vitest 的 projects 模式下 globalSetup 是**按 project** 跑的（每个 project 各有一份 setup/teardown），
 * 而快照只记在自己那份 setup 里。若在 teardown 时直接删除「相对自己快照新增」的目录，
 * 先跑完的 project 会把仍在运行的其它 project 正在使用的数据目录删掉——表现为 fixture 登录 500/401、
 * 或读到默认配置导致的会话不匹配。
 *
 * 因此本轮只把「相对自己 setup 新增的目录」登记到标记文件（与已有登记合并，不覆盖），
 * 等**下一轮 setup** 时再删——那时本轮早已结束，不会再误删任何活跃目录。
 * 代价是目录多存活一轮；换来的是分项目/带路径过滤执行都不会破坏测试。
 * 保留失败现场不变：KEEP_TMP=1 时既不清理也不登记。
 */

const PREFIX = 'dns-pro-'
const MARKER = path.join(os.tmpdir(), '.dns-pro-pending-tmp.json')
const keep = process.env.KEEP_TMP === '1'

async function listTempDirs(): Promise<Set<string>> {
  const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true }).catch(() => [])
  return new Set(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(PREFIX)).map((e) => e.name))
}

async function readPending(): Promise<string[]> {
  const raw = await fs.readFile(MARKER, 'utf8').catch(() => '')
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

let before = new Set<string>()

export async function setup(): Promise<void> {
  if (keep) return
  // 先清掉上一轮登记的残留，再记本轮快照
  const pending = await readPending()
  await Promise.all(
    pending.map((name) => fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true }).catch(() => {}))
  )
  await fs.writeFile(MARKER, '[]', 'utf8').catch(() => {})
  before = await listTempDirs()
}

export async function teardown(): Promise<void> {
  if (keep) return
  // 只登记、不删除：此刻其它 project 可能仍在用自己新建的目录
  const after = await listTempDirs()
  const created = [...after].filter((name) => !before.has(name))
  if (!created.length) return
  const merged = new Set([...(await readPending()), ...created])
  await fs.writeFile(MARKER, JSON.stringify([...merged]), 'utf8').catch(() => {})
}
