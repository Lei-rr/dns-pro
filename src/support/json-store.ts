import fs from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from './api-error.js'

const DATA_ROOT = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'))
const LOCK_TIMEOUT_MS = 5000
const STALE_LOCK_MS = 30000

export class JsonStore<T extends object = Record<string, unknown>> {
  private readonly absolutePath: string

  constructor(
    relativePath: string,
    private readonly defaultValue: T = {} as T
  ) {
    this.absolutePath = path.resolve(DATA_ROOT, relativePath.replace(/^\/+/, ''))
  }

  async read(): Promise<T> {
    try {
      const content = await fs.readFile(this.absolutePath, 'utf-8')
      if (content.trim() === '') {
        return this.defaultValue
      }
      const parsed = JSON.parse(content) as T
      return parsed ?? this.defaultValue
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return this.defaultValue
      }
      throw new ApiError('server_error', `Failed to read ${this.absolutePath}: ${error instanceof Error ? error.message : String(error)}`, 500)
    }
  }

  async write(data: T): Promise<void> {
    await this.ensureDirectory()
    const tmp = this.absolutePath + '.tmp'
    const encoded = JSON.stringify(data, null, 2) + '\n'
    await fs.writeFile(tmp, encoded, 'utf-8')
    await fs.rename(tmp, this.absolutePath)
  }

  async transaction<U>(mutator: (current: T) => { next: T; result?: U }): Promise<U | undefined> {
    await this.ensureDirectory()

    const lockFile = this.absolutePath + '.lock'
    await this.acquireLock(lockFile)

    try {
      const current = await this.read()
      const { next, result } = mutator(current)
      await this.write(next)
      return result
    } finally {
      try {
        await fs.unlink(lockFile)
      } catch {
        // ignore
      }
    }
  }

  getPath(): string {
    return this.absolutePath
  }

  private async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.absolutePath)
    await fs.mkdir(dir, { recursive: true })
  }

  private async acquireLock(lockFile: string): Promise<void> {
    const startedAt = Date.now()

    while (true) {
      try {
        await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, created_at: Date.now() }), { flag: 'wx' })
        return
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error
        }

        await this.removeStaleLock(lockFile)

        if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
          throw new ApiError('server_error', `Timed out waiting for lock ${lockFile}`, 500)
        }

        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }
  }

  private async removeStaleLock(lockFile: string): Promise<void> {
    try {
      const stat = await fs.stat(lockFile)
      if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
        await fs.unlink(lockFile)
      }
    } catch {
      // Lock disappeared between retries.
    }
  }
}
