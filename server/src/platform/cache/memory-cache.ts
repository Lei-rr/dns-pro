type CacheEntry<T> = {
  value: T
  tags: string[]
}

/** Permanent process-memory cache. Entries leave only through explicit invalidation. */
class MemoryCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>()

  get<T>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined
  }

  set<T>(key: string, value: T, tags: string[] = []): void {
    this.entries.set(key, { value, tags })
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

  stats(): { size: number } {
    return { size: this.entries.size }
  }
}

export const memoryCache = new MemoryCache()
