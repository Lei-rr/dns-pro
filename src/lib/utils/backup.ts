import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataRoot } from '../storage/json-store.js'
import { ApiError } from '../http/api-error.js'

/**
 * Lightweight data backup helper.
 * Creates a gzipped tar-like archive is overkill without deps; we zip via simple directory snapshot listing
 * and copy into data/backups as a timestamped folder + optional tgz via system tar if available.
 */
export class BackupService {
  private backupsDir(): string {
    return path.join(getDataRoot(), 'backups')
  }

  async create(): Promise<{ id: string; path: string; files: number }> {
    const id = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path.join(this.backupsDir(), id)
    await fs.mkdir(target, { recursive: true })

    const root = getDataRoot()
    const entries = await fs.readdir(root, { withFileTypes: true })
    let files = 0
    for (const entry of entries) {
      if (entry.name === 'backups' || entry.name === 'cache') continue
      const from = path.join(root, entry.name)
      const to = path.join(target, entry.name)
      if (entry.isDirectory()) {
        await this.copyDir(from, to)
        files += 1
      } else if (entry.isFile()) {
        await fs.copyFile(from, to)
        files += 1
      }
    }

    // optional compressed marker file for human operators
    try {
      const note = path.join(target, 'BACKUP.txt')
      await fs.writeFile(note, `dns-pro backup\nid=${id}\ncreated_at=${new Date().toISOString()}\n`, 'utf-8')
    } catch {
      // ignore
    }

    return { id, path: target, files }
  }

  async list(): Promise<Array<{ id: string; path: string; created_at?: string }>> {
    const dir = this.backupsDir()
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: e.name, path: path.join(dir, e.name), created_at: e.name }))
        .sort((a, b) => b.id.localeCompare(a.id))
    } catch {
      return []
    }
  }

  async restore(id: string): Promise<{ id: string; restored: number }> {
    const source = path.join(this.backupsDir(), id)
    try {
      await fs.access(source)
    } catch {
      throw new ApiError('backup_not_found', `Backup ${id} not found`, 404)
    }

    const root = getDataRoot()
    const entries = await fs.readdir(source, { withFileTypes: true })
    let restored = 0
    for (const entry of entries) {
      if (entry.name === 'BACKUP.txt') continue
      const from = path.join(source, entry.name)
      const to = path.join(root, entry.name)
      if (entry.isDirectory()) {
        await this.copyDir(from, to)
        restored += 1
      } else if (entry.isFile()) {
        await fs.copyFile(from, to)
        restored += 1
      }
    }
    return { id, restored }
  }

  private async copyDir(from: string, to: string): Promise<void> {
    await fs.mkdir(to, { recursive: true })
    const entries = await fs.readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      const src = path.join(from, entry.name)
      const dst = path.join(to, entry.name)
      if (entry.isDirectory()) await this.copyDir(src, dst)
      else if (entry.isFile()) await fs.copyFile(src, dst)
    }
  }
}

export const backupService = new BackupService()
