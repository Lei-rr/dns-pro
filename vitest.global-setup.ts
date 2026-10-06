import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * 测试临时目录清理：被测代码与测试都用 tmpdir + mkdtemp 建数据目录，
 * 单个用例内清理会掩盖失败现场，全部不清理又会持续堆积。
 * 折中做法是只在整轮测试结束后删掉「本轮新建的」目录——用运行前后快照的差集判定，
 * 既不需要每个测试文件写清理钩子，也不会误删上一轮遗留的失败现场（保留现场设 KEEP_TMP=1）。
 */

const PREFIX = 'dns-pro-'
const keep = process.env.KEEP_TMP === '1'

async function listTempDirs(): Promise<Set<string>> {
  const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true }).catch(() => [])
  return new Set(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(PREFIX)).map((e) => e.name))
}

let before = new Set<string>()

export async function setup(): Promise<void> {
  before = await listTempDirs()
}

export async function teardown(): Promise<void> {
  if (keep) return
  const after = await listTempDirs()
  const created = [...after].filter((name) => !before.has(name))
  await Promise.all(
    created.map((name) => fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true }).catch(() => {}))
  )
}
