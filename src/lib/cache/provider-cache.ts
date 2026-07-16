import { globalCache } from './cache-service.js'
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
  source: 'cache' | 'provider'
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

/**
 * Unified cache helper for provider list/detail reads.
 *
 * Rules:
 * - refresh=false => return cache hit when present
 * - refresh=true  or cache miss => call loader, store, return fresh data
 *
 * Unlike aws-pro lookup caches, DNS list endpoints still fetch provider data on miss
 * so the panel remains usable without an explicit refresh on first open.
 */
export async function withProviderCache<T>(options: {
  key: string | { prefix: string; parts: Record<string, unknown> }
  tags?: string[]
  ttlMs?: number
  refresh?: boolean
  loader: () => Promise<T>
}): Promise<CachedResult<T>> {
  const refresh = Boolean(options.refresh)
  const key =
    typeof options.key === 'string'
      ? options.key
      : buildCacheKey(options.key.prefix, options.key.parts)
  const ttlMs = options.ttlMs ?? CacheTtl.providerData
  const tags = options.tags ?? []

  if (!refresh) {
    const cached = globalCache.get<T>(key)
    if (cached !== undefined) {
      return {
        value: cached,
        hit: true,
        meta: { cache: true, cached: true, source: 'cache' },
      }
    }
  }

  const value = await options.loader()
  globalCache.set(key, value, ttlMs, tags)
  return {
    value,
    hit: false,
    meta: { cache: false, cached: false, source: 'provider' },
  }
}

export function invalidateProviderCache(tags: string[]): void {
  globalCache.invalidateTags(tags)
}

export {
  buildCacheKey,
  globalCache,
  offsetPaginationMeta,
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
  zoneCacheTag,
}
