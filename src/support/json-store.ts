import fs from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from './api-error.js'

const DATA_ROOT = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'))

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

    // 简单文件锁：用 .lock 文件做独占锁，适合本项目单实例部署
    const lockFile = this.absolutePath + '.lock'
    const acquireLock = async (): Promise<void> => {
      try {
        await fs.writeFile(lockFile, String(process.pid), { flag: 'wx' })
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return acquireLock()
        }
        throw error
      }
    }

    await acquireLock()

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
}
