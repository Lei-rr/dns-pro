import fs from 'node:fs/promises'
import path from 'node:path'

const BACKUPS_DIR = 'backups'

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
  await fs.mkdir(target, { recursive: true, mode: 0o700 })
  await copyTree(dataRoot, target, (source) => source.startsWith(backups))
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

/** 仅保留最近 keep 份备份（按名字排序 = 时间排序），返回删除数量 */
export async function pruneBackups(dataRoot: string, keep: number): Promise<number> {
  const backups = path.join(dataRoot, BACKUPS_DIR)
  const entries = await fs.readdir(backups, { withFileTypes: true }).catch(() => [])
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const excess = names.slice(0, Math.max(0, names.length - keep))
  for (const name of excess) {
    await fs.rm(path.join(backups, name), { recursive: true, force: true })
  }
  return excess.length
}
