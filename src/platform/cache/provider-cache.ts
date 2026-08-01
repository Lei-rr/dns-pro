import { memoryCache } from './memory-cache.js'

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

type CacheKey = string | { prefix: string; parts: Record<string, unknown> }

type ProviderCacheOptions<T> = {
  key: CacheKey
  tags?: string[]
  refresh?: boolean
  loader: () => Promise<T>
}

const keyGenerations = new Map<string, number>()
const tagGenerations = new Map<string, number>()
const loadGenerations = new Map<string, number>()
const inflight = new Map<string, Promise<CachedResult<unknown>>>()

export function parseRefreshFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['1', 'true'].includes(value.trim().toLowerCase())
  return false
}

/** Cache-first provider read. A cold miss loads; refresh bypasses and replaces the entry. */
export async function withProviderCache<T>(options: ProviderCacheOptions<T>): Promise<CachedResult<T>> {
  const key = resolveKey(options.key)
  const tags = options.tags ?? []

  if (!options.refresh) {
    const hit = memoryCache.get<T>(key)
    if (hit !== undefined) {
      return { value: hit, hit: true, meta: { cache: true, cached: true, source: 'cache' } }
    }
    const pending = inflight.get(key)
    if (pending) return pending as Promise<CachedResult<T>>
  }

  const fence = {
    key: keyGenerations.get(key) ?? 0,
    tags: tags.map((tag) => [tag, tagGenerations.get(tag) ?? 0] as const),
    load: (loadGenerations.get(key) ?? 0) + 1,
  }
  loadGenerations.set(key, fence.load)
  const loading = (async (): Promise<CachedResult<T>> => {
    const value = await options.loader()
    const current =
      fence.key === (keyGenerations.get(key) ?? 0) &&
      fence.load === (loadGenerations.get(key) ?? 0) &&
      fence.tags.every(([tag, generation]) => generation === (tagGenerations.get(tag) ?? 0))
    if (current) memoryCache.set(key, value, tags)

    return { value, hit: false, meta: { cache: false, cached: false, source: 'provider' } }
  })()
  if (!options.refresh) inflight.set(key, loading)
  try {
    return await loading
  } finally {
    if (inflight.get(key) === loading) inflight.delete(key)
  }
}

export function invalidateProviderCache(options: { tags?: string[]; keys?: CacheKey[] }): void {
  const tags = options.tags ?? []
  const keys = (options.keys ?? []).map(resolveKey)
  for (const tag of tags) tagGenerations.set(tag, (tagGenerations.get(tag) ?? 0) + 1)
  for (const key of keys) keyGenerations.set(key, (keyGenerations.get(key) ?? 0) + 1)
  memoryCache.invalidateTags(tags)
  for (const key of keys) memoryCache.delete(key)
}

export function providerCacheStats(): { size: number } {
  return memoryCache.stats()
}

export function buildCacheKey(prefix: string, parts: Record<string, unknown>): string {
  const entries = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(stringifyValue(value))}`)
  return [prefix, ...entries].join(':')
}

function resolveKey(key: CacheKey): string {
  return typeof key === 'string' ? key : buildCacheKey(key.prefix, key.parts)
}

function stringifyValue(value: unknown): string {
  if (value === null) return 'null:'
  if (value === undefined) return 'undefined:'
  if (typeof value === 'boolean') return `boolean:${value ? '1' : '0'}`
  if (typeof value === 'number') return `number:${String(value)}`
  if (typeof value === 'string') return `string:${value}`
  return `json:${stableJson(value)}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function offsetPaginationMeta(pagination: { offset: number; limit: number; total: number }) {
  const { offset, limit, total } = pagination
  return {
    page: limit > 0 ? Math.floor(offset / limit) + 1 : 1,
    per_page: limit,
    offset,
    limit,
    total,
    total_pages: limit > 0 ? Math.ceil(total / limit) : 1,
  }
}

export function pagePaginationMeta(
  resultInfo:
    | {
        page?: number | null
        per_page?: number | null
        count?: number | null
        total_count?: number | null
        total_pages?: number | null
      }
    | undefined,
  page: number,
  perPage: number
): {
  page: number
  per_page: number
  offset: number
  limit: number
  count: number | null
  total: number | null
  total_pages: number | null
} {
  const resolvedPage = Number(resultInfo?.page ?? page)
  const resolvedPerPage = Number(resultInfo?.per_page ?? perPage)
  const count = resultInfo?.count !== undefined && resultInfo.count !== null ? Number(resultInfo.count) : null
  const total =
    resultInfo?.total_count !== undefined && resultInfo.total_count !== null ? Number(resultInfo.total_count) : null
  return {
    page: resolvedPage,
    per_page: resolvedPerPage,
    offset: Math.max(0, (resolvedPage - 1) * resolvedPerPage),
    limit: resolvedPerPage,
    count,
    total,
    total_pages:
      resultInfo?.total_pages !== undefined && resultInfo.total_pages !== null ? Number(resultInfo.total_pages) : null,
  }
}

export function providerCacheTag(providerId: string): string {
  return `provider:${providerId}`
}

export function zoneCacheTag(providerType: string, providerId: string): string {
  return `${providerType}:zones:${providerId}`
}

export function recordCacheTag(providerType: string, providerId: string, zone: string): string {
  return `${providerType}:records:${providerId}:${zone}`
}

export function customHostnameListCacheTag(cloudflareProviderId: string, zoneId: string): string {
  return `cloudflare:custom_hostnames:list:${cloudflareProviderId}:${zoneId}`
}

export function customHostnameDetailsCacheTag(cloudflareProviderId: string, zoneId: string): string {
  return `cloudflare:custom_hostnames:details:${cloudflareProviderId}:${zoneId}`
}

export function fallbackOriginCacheTag(cloudflareProviderId: string, zoneId: string): string {
  return `cloudflare:fallback_origin:${cloudflareProviderId}:${zoneId}`
}

export function edgeoneZonesCacheTag(providerId: string): string {
  return `edgeone:zones:${providerId}`
}

export function edgeoneDomainsCacheTag(providerId: string, zoneId: string): string {
  return `edgeone:domains:${providerId}:${zoneId}`
}

export function cloudflaredTunnelsCacheTag(providerId: string): string {
  return `cloudflared:tunnels:${providerId}`
}

export function cloudflaredTunnelConfigCacheTag(providerId: string, tunnelId: string): string {
  return `cloudflared:tunnel_config:${providerId}:${tunnelId}`
}
