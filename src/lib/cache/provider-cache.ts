import { cacheManager, globalCache, type CacheResult } from './cache-manager.js'
import {
  buildCacheKey,
  cloudflaredTunnelConfigCacheTag,
  cloudflaredTunnelsCacheTag,
  customHostnameCacheTag,
  edgeoneDomainsCacheTag,
  edgeoneZonesCacheTag,
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
  source: 'cache' | 'provider' | 'memory' | 'loader' | 'miss'
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
    result.meta.source === 'memory'
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
    },
  }
}

/**
 * Memory-only helper for reconstructable provider data (zones/records/hostnames/tunnels).
 * Cold miss still loads from provider so first open works without explicit refresh.
 */
export async function withProviderCache<T>(options: {
  key: string | { prefix: string; parts: Record<string, unknown> }
  tags?: string[]
  ttlMs?: number
  refresh?: boolean
  loader: () => Promise<T>
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
  })
  return mapResult(result)
}

export function invalidateProviderCache(tags: string[]): void {
  cacheManager.invalidate({ tags })
}

export {
  buildCacheKey,
  cacheManager,
  cloudflaredTunnelConfigCacheTag,
  cloudflaredTunnelsCacheTag,
  customHostnameCacheTag,
  edgeoneDomainsCacheTag,
  edgeoneZonesCacheTag,
  globalCache,
  offsetPaginationMeta,
  pagePaginationMeta,
  providerCacheTag,
  recordCacheTag,
  zoneCacheTag,
}
