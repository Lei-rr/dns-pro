import fs from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from '../http/api-error.js'
import { errorMessage } from '../../shared/values.js'
import { runSerial } from '../../shared/serial-queue.js'
import { resolveDataPath } from './data-root.js'

const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT'

/**
 * JSON 文件存储（单进程独占数据目录）。
 * - 数据根与内存缓存都由实例持有：不存在模块级可变全局（D7）
 * - 同一路径的读写串行执行；队列键为绝对路径且跨实例共享，多个实例操作同一文件也不会交错
 * - 写入：临时文件 + fsync + rename 原子替换，权限 0600
 * - 读取：实例内内存缓存，transaction 总是基于磁盘最新内容
 */
export class JsonStore<T extends object = Record<string, unknown>> {
  /** 实例级读缓存；跨实例读同一文件各自回源磁盘（写入始终落盘） */
  private readonly memory = new Map<string, T>()

  constructor(
    private readonly relativePath: string,
    private readonly defaultValue: T = {} as T,
    private readonly dataRoot: string
  ) {
    // 构造时即校验路径不越界
    this.absolutePath()
  }

  async read(): Promise<T> {
    const cached = this.memory.get(this.absolutePath())
    if (cached !== undefined) return structuredClone(cached)
    return this.readFresh()
  }

  /** 等待此前写入完成后读取磁盘内容 */
  async readFresh(): Promise<T> {
    return runSerial(this.absolutePath(), async () => {
      const data = await this.readFromDisk()
      this.memory.set(this.absolutePath(), structuredClone(data))
      return data
    })
  }

  async write(data: T): Promise<void> {
    await runSerial(this.absolutePath(), () => this.writeUnlocked(data))
  }

  /** 读-改-写事务；mutator 抛异常时不写入 */
  async transaction<U>(mutator: (current: T) => { next: T; result?: U }): Promise<U | undefined> {
    return runSerial(this.absolutePath(), async () => {
      const { next, result } = mutator(await this.readFromDisk())
      await this.writeUnlocked(next)
      return result
    })
  }

  invalidateMemory(): void {
    this.memory.delete(this.absolutePath())
  }

  private absolutePath(): string {
    return resolveDataPath(this.dataRoot, this.relativePath)
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
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw new ApiError('server_error', `Failed to write ${this.relativePath}: ${errorMessage(error)}`, 500)
    }
    this.memory.set(filePath, structuredClone(data))
  }

  private async readFromDisk(): Promise<T> {
    const filePath = this.absolutePath()
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf8')
    } catch (error) {
      if (isMissing(error)) return structuredClone(this.defaultValue)
      throw new ApiError('server_error', `Failed to read ${this.relativePath}: ${errorMessage(error)}`, 500)
    }
    // 收紧历史文件权限；失败（如只读挂载）不影响读取
    await fs.chmod(filePath, 0o600).catch(() => undefined)
    if (content.trim() === '') return structuredClone(this.defaultValue)
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      // 损坏文件不自动覆盖，避免数据丢失；提示人工修复
      throw new ApiError('server_error', `Corrupted JSON in ${this.relativePath}: ${errorMessage(error)}`, 500)
    }
    // 顶层必须是普通对象：`T extends object` 的契约不含数组/标量/null。
    // 这类结构损坏同样不自动覆盖——被下游当空表读走再写回，等价于把整份数据抹掉。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError('server_error', `Corrupted JSON in ${this.relativePath}: expected a JSON object`, 500)
    }
    return parsed as T
  }
}
