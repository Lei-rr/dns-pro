type CacheEntry<T> = {
  value: T
  tags: string[]
  expiresAt: number
}

/** 默认存活时间：外部（控制台/其它工具）改动最多滞后这么久；显式 refresh 与变更失效不受影响 */
export const CACHE_TTL_MS = 5 * 60 * 1000
/** 默认容量：超出后按最久未使用淘汰，避免 key 含用户输入时无限增长 */
export const CACHE_MAX_ENTRIES = 500

/**
 * 进程内缓存：带存活时间与容量上限。
 * - 读取命中过期条目时按未命中处理并删除（惰性过期，无定时器）
 * - 命中即刷新使用顺序，超出容量时淘汰最久未使用的条目
 * - 只读约定：调用方不得原地修改取出的值（大列表不做克隆，避免无谓开销）
 */
export class MemoryCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>()
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS
    this.maxEntries = options.maxEntries ?? CACHE_MAX_ENTRIES
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Map 保持插入顺序：命中后移到末尾即为 LRU 顺序
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value as T
  }

  set<T>(key: string, value: T, tags: string[] = []): void {
    this.entries.delete(key)
    this.entries.set(key, { value, tags, expiresAt: Date.now() + this.ttlMs })
    this.prune()
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  invalidateTags(tags: string[]): void {
    if (tags.length === 0) return
    const invalid = new Set(tags)
    for (const [key, entry] of this.entries) {
      if (entry.tags.some((tag) => invalid.has(tag))) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  /** 统计未过期条目：惰性过期下没有写入时 size 也必须反映真实容量 */
  stats(): { size: number } {
    const now = Date.now()
    let size = 0
    for (const entry of this.entries.values()) {
      if (entry.expiresAt > now) size++
    }
    return { size }
  }

  /** 清理过期条目并维持容量上限（写入时顺带执行，避免后台定时器） */
  private prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

/**
 * 当前进程使用的缓存实例。
 * 由装配层在启动阶段安装（见 app/lifecycle.ts 的 initKernel）：读路径统一经 activeMemoryCache() 取用，
 * 不再散落的模块级单例，探针也可以换成自己的隔离实例。
 */
let activeInstance = new MemoryCache()

export function activeMemoryCache(): MemoryCache {
  return activeInstance
}

/** 安装装配层创建的实例；同一进程内重复装配（探针）会各自从干净缓存开始 */
export function installMemoryCache(instance: MemoryCache): void {
  activeInstance = instance
}
