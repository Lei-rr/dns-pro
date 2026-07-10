interface CacheEntry<T> {
  value: T
  expiresAt: number
  tags: string[]
}

interface CacheOptions {
  maxEntries?: number
  sweepIntervalMs?: number
}

const DEFAULT_MAX_ENTRIES = 1000
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000

export class CacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>()
  private maxEntries: number
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: CacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
    this.startSweepTimer(options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS)
  }

  updateOptions(options: CacheOptions): void {
    if (options.maxEntries !== undefined) {
      this.maxEntries = Math.max(1, options.maxEntries)
    }
    if (options.sweepIntervalMs !== undefined) {
      this.stopSweepTimer()
      this.startSweepTimer(options.sweepIntervalMs)
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set<T>(key: string, value: T, ttlMs: number, tags: string[] = []): void {
    if (this.store.has(key)) {
      this.store.delete(key)
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      tags,
    })

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value
      if (!oldestKey) break
      this.store.delete(oldestKey)
    }
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  invalidateTags(tags: string[]): void {
    const tagSet = new Set(tags)
    for (const [key, entry] of this.store.entries()) {
      if (entry.tags.some((tag) => tagSet.has(tag))) {
        this.store.delete(key)
      }
    }
  }

  clear(): void {
    this.store.clear()
  }

  stats(): { size: number; maxEntries: number } {
    return { size: this.store.size, maxEntries: this.maxEntries }
  }

  private startSweepTimer(intervalMs: number): void {
    this.stopSweepTimer()
    this.sweepTimer = setInterval(() => {
      this.sweepExpired()
    }, Math.max(1000, intervalMs))
    this.sweepTimer.unref()
  }

  private stopSweepTimer(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  private sweepExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.store.delete(key)
      }
    }
  }
}

export const globalCache = new CacheService()
