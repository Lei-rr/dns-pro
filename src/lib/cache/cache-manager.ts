import { globalCache } from './cache-service.js'
import { buildCacheKey } from './cache-helpers.js'

export type CacheReadMode = {
  refresh?: boolean
  cacheOnly?: boolean
}

export type CacheSource = 'memory' | 'loader' | 'miss'

export type CacheMeta = {
  cache: boolean
  cached: boolean
  source: CacheSource
}

export type CacheResult<T> = {
  value: T
  hit: boolean
  meta: CacheMeta
}

export type CacheGetOrLoadOptions<T> = {
  key: string | { prefix: string; parts: Record<string, unknown> }
  ttlMs: number
  tags?: string[]
  mode?: CacheReadMode
  emptyOnMiss?: T
  loader?: () => Promise<T>
}

function resolveKey(key: string | { prefix: string; parts: Record<string, unknown> }): string {
  return typeof key === 'string' ? key : buildCacheKey(key.prefix, key.parts)
}

/**
 * Memory-only cache facade for reconstructable provider query results.
 * Local durable data should use JsonStore (file + memory), not this module.
 */
export class CacheManager {
  async getOrLoad<T>(options: CacheGetOrLoadOptions<T>): Promise<CacheResult<T>> {
    const mode = {
      refresh: Boolean(options.mode?.refresh),
      // Respect explicit cacheOnly; only default to cache-only when refresh is off and caller omitted it.
      cacheOnly:
        options.mode?.cacheOnly !== undefined
          ? Boolean(options.mode.cacheOnly)
          : !Boolean(options.mode?.refresh),
    }
    const key = resolveKey(options.key)
    const tags = options.tags ?? []
    const ttlMs = options.ttlMs

    if (!mode.refresh) {
      const memoryHit = globalCache.get<T>(key)
      if (memoryHit !== undefined) {
        return {
          value: memoryHit,
          hit: true,
          meta: { cache: true, cached: true, source: 'memory' },
        }
      }

      if (mode.cacheOnly || !options.loader) {
        return {
          value: options.emptyOnMiss as T,
          hit: false,
          meta: { cache: false, cached: false, source: 'miss' },
        }
      }
    } else if (!options.loader) {
      return {
        value: options.emptyOnMiss as T,
        hit: false,
        meta: { cache: false, cached: false, source: 'miss' },
      }
    }

    const value = await options.loader!()
    globalCache.set(key, value, ttlMs, tags)
    return {
      value,
      hit: false,
      meta: { cache: false, cached: false, source: 'loader' },
    }
  }

  invalidate(options: { tags?: string[]; keys?: string[] }): void {
    const tags = options.tags ?? []
    const keys = options.keys ?? []
    if (tags.length) globalCache.invalidateTags(tags)
    for (const key of keys) globalCache.delete(key)
  }

  stats() {
    return globalCache.stats()
  }
}

export const cacheManager = new CacheManager()
export { buildCacheKey, globalCache }
