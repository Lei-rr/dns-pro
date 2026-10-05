import fs from 'node:fs/promises'
import path from 'node:path'

const BACKUPS_DIR = 'backups'

/** 未完成备份的临时目录前缀：进程中途退出留下的形态，不参与保留计数 */
const TEMP_PREFIX = '.tmp-'

/** 备份标签：<前缀>-YYYYMMDD-HHMMSS（字典序即时间序） */
export function backupLabel(prefix: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
    .replace('T', '-')
  return `${prefix}-${stamp}`
}

/** 复制整个 data 目录到 backups/<label>（排除既有备份，防止自嵌套），返回备份路径 */
export async function backupDataRoot(dataRoot: string, label: string): Promise<string> {
  const backups = path.join(dataRoot, BACKUPS_DIR)
  const target = path.join(backups, label)
  // 先写临时目录、全部成功后原子改名：中途退出只会留下可识别的临时残留，
  // 不会让 pruneBackups 把半个备份当有效备份参与保留计数
  const temporary = path.join(backups, `${TEMP_PREFIX}${label}-${process.pid}-${Math.random().toString(16).slice(2)}`)
  try {
    await fs.mkdir(temporary, { recursive: true, mode: 0o700 })
    // 按路径边界排除：backups-old 这类仅前缀相同的同级条目仍属数据，必须照常备份
    await copyTree(dataRoot, temporary, (source) => source === backups || source.startsWith(`${backups}${path.sep}`))
    await fs.rename(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return target
}

/** 递归复制；fs.cp 拒绝"复制到自身子目录"，因此手写并对 backups 子树显式跳过 */
async function copyTree(source: string, target: string, skip: (source: string) => boolean): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    if (skip(from)) continue
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true, mode: 0o700 })
      await copyTree(from, to, skip)
    } else if (entry.isFile()) {
      await fs.copyFile(from, to)
      await fs.chmod(to, 0o600).catch(() => undefined)
    }
  }
}

/** 仅保留最近 keep 份备份（按目录 mtime 判定新旧），返回删除数量 */
export async function pruneBackups(dataRoot: string, keep: number): Promise<number> {
  const backups = path.join(dataRoot, BACKUPS_DIR)
  const entries = await fs.readdir(backups, { withFileTypes: true }).catch(() => [])
  // 不能按名字排序：标签前缀由调用方决定（pre-vN / keep-N），混合前缀或多个位数的版本号会删错较新的备份
  const dated = await Promise.all(
    entries
      // 临时命名 = 写入未完成的残留：不能当有效备份参与保留计数（原子改名成功后不会存在）
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(TEMP_PREFIX))
      .map(async (entry) => {
        const stats = await fs.stat(path.join(backups, entry.name)).catch(() => null)
        return { name: entry.name, mtimeMs: stats?.mtimeMs ?? 0 }
      })
  )
  const excess = dated
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, dated.length - keep))
  for (const entry of excess) {
    await fs.rm(path.join(backups, entry.name), { recursive: true, force: true })
  }
  return excess.length
}
