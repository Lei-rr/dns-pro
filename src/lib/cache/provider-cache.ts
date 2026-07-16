import { cacheManager, globalCache, type CacheResult } from './cache-manager.js'
import {
  buildCacheKey,
  offsetPaginationMeta,
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
  zoneCacheTag,
} from './cache-helpers.js'

export type CacheReadMode = {
  refresh?: boolean
}

export type CacheMeta = {
  cache: boolean
  cached: boolean
  source: 'cache' | 'provider' | 'memory' | 'file' | 'loader' | 'miss'
  store?: 'memory' | 'file' | 'layered'
}

export type CachedResult<T> = {
  value: T
  meta: CacheMeta
  hit: boolean
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Shared TTL presets for dns-pro provider data. */
export const CacheTtl = {
  /** Zones / records / hostnames / tunnels: long-lived until mutation or manual refresh. */
  providerData: 3 * DAY,
  /** Short-lived operational lookups if needed later. */
  short: 5 * 60 * 1000,
} as const

export function parseRefreshFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
  }
  return false
}

function mapResult<T>(result: CacheResult<T>): CachedResult<T> {
  const source =
    result.meta.source === 'memory' || result.meta.source === 'file'
      ? 'cache'
      : result.meta.source === 'loader'
        ? 'provider'
        : (result.meta.source as CacheMeta['source'])

  return {
    value: result.value,
    hit: result.hit,
    meta: {
      cache: result.meta.cache,
      cached: result.meta.cached,
      source,
      store: result.meta.store,
    },
  }
}

/**
 * Unified cache helper for provider list/detail reads.
 *
 * Default store is layered (memory + file under data/cache/provider):
 * - refresh=false => return cache hit when present
 * - refresh=true or cache miss => call loader, store, return fresh data
 */
export async function withProviderCache<T>(options: {
  key: string | { prefix: string; parts: Record<string, unknown> }
  tags?: string[]
  ttlMs?: number
  refresh?: boolean
  loader: () => Promise<T>
  store?: 'memory' | 'file' | 'layered'
}): Promise<CachedResult<T>> {
  const result = await cacheManager.getOrLoad<T>({
    key: options.key,
    tags: options.tags,
    ttlMs: options.ttlMs ?? CacheTtl.providerData,
    mode: {
      refresh: Boolean(options.refresh),
      cacheOnly: false,
    },
    loader: options.loader,
    store: options.store ?? 'layered',
    namespace: 'provider',
  })
  return mapResult(result)
}

export async function invalidateProviderCache(tags: string[]): Promise<void> {
  await cacheManager.invalidate({ tags, namespace: 'provider', store: 'all' })
}

export {
  buildCacheKey,
  cacheManager,
  globalCache,
  offsetPaginationMeta,
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
  zoneCacheTag,
}
