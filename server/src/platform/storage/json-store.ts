import fs from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from '../../shared/http/api-error.js'
import { getDataRoot, onDataRootChanged, resolveDataPath, setDataRoot } from './data-root.js'

export { getDataRoot, setDataRoot }

const memoryStore = new Map<string, unknown>()
const queues = new Map<string, Promise<void>>()
onDataRootChanged(() => memoryStore.clear())

/** JSON file storage for the single application process which owns the data directory. */
export class JsonStore<T extends object = Record<string, unknown>> {
  private readonly relativePath: string
  private readonly dataRoot: string | undefined

  constructor(
    relativePath: string,
    private readonly defaultValue: T = {} as T,
    dataRoot?: string
  ) {
    this.relativePath = relativePath
    this.dataRoot = dataRoot
    resolveDataPath(this.dataRoot ?? getDataRoot(), this.relativePath)
  }

  async read(): Promise<T> {
    const filePath = this.absolutePath()
    if (memoryStore.has(filePath)) return this.clone(memoryStore.get(filePath) as T)
    return this.readFresh()
  }

  /** Read disk truth after prior writes to this absolute path have completed. */
  async readFresh(): Promise<T> {
    return this.serialized(async () => {
      const data = await this.readFromDisk()
      memoryStore.set(this.absolutePath(), this.clone(data))
      return this.clone(data)
    })
  }

  async write(data: T): Promise<void> {
    await this.serialized(() => this.writeUnlocked(data))
  }

  async transaction<U>(mutator: (current: T) => { next: T; result?: U }): Promise<U | undefined> {
    return this.serialized(async () => {
      const current = await this.readFromDisk()
      const { next, result } = mutator(current)
      await this.writeUnlocked(next)
      return result
    })
  }

  invalidateMemory(): void {
    memoryStore.delete(this.absolutePath())
  }

  getPath(): string {
    return this.absolutePath()
  }

  private absolutePath(): string {
    return resolveDataPath(this.dataRoot ?? getDataRoot(), this.relativePath)
  }

  private clone(value: T): T {
    return structuredClone(value)
  }

  private async serialized<U>(task: () => Promise<U>): Promise<U> {
    const key = this.absolutePath()
    const previous = queues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    const settled = current.then(
      () => undefined,
      () => undefined
    )
    queues.set(key, settled)
    try {
      return await current
    } finally {
      if (queues.get(key) === settled) queues.delete(key)
    }
  }

  private async writeUnlocked(data: T): Promise<void> {
    const filePath = this.absolutePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(temporary, filePath)
      await fs.chmod(filePath, 0o600)
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    memoryStore.set(filePath, this.clone(data))
  }

  private async readFromDisk(): Promise<T> {
    const filePath = this.absolutePath()
    try {
      await fs.chmod(filePath, 0o600)
      const content = await fs.readFile(filePath, 'utf8')
      if (content.trim() === '') return this.clone(this.defaultValue)
      return this.clone((JSON.parse(content) as T) ?? this.defaultValue)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return this.clone(this.defaultValue)
      throw new ApiError(
        'server_error',
        `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        500
      )
    }
  }
}
