import fs from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from '../http/api-error.js'

let dataRoot = path.join(process.cwd(), 'data')
const LOCK_TIMEOUT_MS = 5000
const STALE_LOCK_MS = 30000

/** Process-local memory view of JSON files. File remains source of truth on disk. */
const memoryStore = new Map<string, unknown>()

export function setDataRoot(root: string): void {
  dataRoot = path.resolve(root)
  // Data root change invalidates in-memory views bound to previous paths.
  memoryStore.clear()
}

export function getDataRoot(): string {
  return dataRoot
}

export class JsonStore<T extends object = Record<string, unknown>> {
  private readonly relativePath: string
  private readonly dataRoot: string | undefined

  constructor(
    relativePath: string,
    private readonly defaultValue: T = {} as T,
    dataRoot?: string
  ) {
    this.relativePath = relativePath.replace(/^\/+/, '')
    this.dataRoot = dataRoot
  }

  private absolutePath(): string {
    return path.resolve(this.dataRoot ?? getDataRoot(), this.relativePath)
  }

  private memoryKey(): string {
    return this.absolutePath()
  }

  private clone(value: T): T {
    // Structured clone keeps callers from mutating the cached object in place.
    return structuredClone(value)
  }

  private readMemory(): T | undefined {
    if (!memoryStore.has(this.memoryKey())) return undefined
    return this.clone(memoryStore.get(this.memoryKey()) as T)
  }

  private writeMemory(data: T): void {
    memoryStore.set(this.memoryKey(), this.clone(data))
  }

  /** Drop this store's memory view (e.g. after external file replacement). */
  invalidateMemory(): void {
    memoryStore.delete(this.memoryKey())
  }

  async read(): Promise<T> {
    const cached = this.readMemory()
    if (cached !== undefined) return cached

    const filePath = this.absolutePath()
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      if (content.trim() === '') {
        const fallback = this.clone(this.defaultValue)
        this.writeMemory(fallback)
        return this.clone(fallback)
      }
      const parsed = (JSON.parse(content) as T) ?? this.defaultValue
      this.writeMemory(parsed)
      return this.clone(parsed)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const fallback = this.clone(this.defaultValue)
        this.writeMemory(fallback)
        return this.clone(fallback)
      }
      throw new ApiError('server_error', `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`, 500)
    }
  }

  async write(data: T): Promise<void> {
    const filePath = this.absolutePath()
    await this.ensureDirectory()
    const tmp = filePath + '.tmp'
    const encoded = JSON.stringify(data, null, 2) + '\n'
    const handle = await fs.open(tmp, 'w')
    try {
      await handle.writeFile(encoded, 'utf-8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, filePath)
    // Keep memory coherent with durable file state.
    this.writeMemory(data)
  }

  async transaction<U>(mutator: (current: T) => { next: T; result?: U }): Promise<U | undefined> {
    const filePath = this.absolutePath()
    await this.ensureDirectory()

    const lockFile = filePath + '.lock'
    await this.acquireLock(lockFile)

    try {
      // Bypass memory during locked mutation so concurrent writers see disk truth.
      this.invalidateMemory()
      const current = await this.readFromDisk()
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
    return this.absolutePath()
  }

  private async readFromDisk(): Promise<T> {
    const filePath = this.absolutePath()
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      if (content.trim() === '') return this.clone(this.defaultValue)
      const parsed = (JSON.parse(content) as T) ?? this.defaultValue
      return this.clone(parsed)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return this.clone(this.defaultValue)
      }
      throw new ApiError('server_error', `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`, 500)
    }
  }

  private async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.absolutePath())
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
