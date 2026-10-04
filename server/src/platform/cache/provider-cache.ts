import { memoryCache } from './memory-cache.js'

type CacheMeta = {
  cache: boolean
  cached: boolean
  source: 'cache' | 'provider'
}

type CachedResult<T> = {
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

// 代次仅用于拦截「失效后才完成的在途加载」。映射有容量上限：
// 超限淘汰后比较结果不相等，只会放弃写入（失败方向是安全的）。
const GENERATION_LIMIT = 4096
const tagGenerations = new Map<string, number>()
const loadGenerations = new Map<string, number>()

/** 有上限的写入：超出后淘汰最早插入的键 */
function bumpGeneration(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
  while (map.size > GENERATION_LIMIT) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}
type InflightEntry = {
  promise: Promise<CachedResult<unknown>>
  tagGenerations: ReadonlyArray<readonly [string, number]>
}
const inflight = new Map<string, InflightEntry>()

/**
 * 供应商查询：缓存优先。冷缺失回填，refresh 绕过并覆盖。
 * 条目带存活时间与容量上限，见 memory-cache。
 */
export async function withProviderCache<T>(options: ProviderCacheOptions<T>): Promise<CachedResult<T>> {
  const key = resolveKey(options.key)
  const tags = options.tags ?? []

  if (!options.refresh) {
    const hit = memoryCache.get<T>(key)
    if (hit !== undefined) {
      return { value: hit, hit: true, meta: { cache: true, cached: true, source: 'cache' } }
    }
    const pending = inflight.get(key)
    if (pending && pending.tagGenerations.every(([tag, generation]) => generation === (tagGenerations.get(tag) ?? 0))) {
      return pending.promise as Promise<CachedResult<T>>
    }
  }

  const fence = {
    tags: tags.map((tag) => [tag, tagGenerations.get(tag) ?? 0] as const),
    load: (loadGenerations.get(key) ?? 0) + 1,
  }
  bumpGeneration(loadGenerations, key)
  const loading = (async (): Promise<CachedResult<T>> => {
    const value = await options.loader()
    const current =
      fence.load === (loadGenerations.get(key) ?? 0) &&
      fence.tags.every(([tag, generation]) => generation === (tagGenerations.get(tag) ?? 0))
    if (current) memoryCache.set(key, value, tags)

    return { value, hit: false, meta: { cache: false, cached: false, source: 'provider' } }
  })()
  const inflightEntry: InflightEntry = { promise: loading, tagGenerations: fence.tags }
  if (!options.refresh) inflight.set(key, inflightEntry)
  try {
    return await loading
  } finally {
    if (inflight.get(key) === inflightEntry) inflight.delete(key)
  }
}

/** 按标签失效：标签覆盖 provider/zone/record 等维度，同时拦截在途加载的写入 */
export function invalidateProviderCache(options: { tags?: string[] }): void {
  const tags = options.tags ?? []
  for (const tag of tags) bumpGeneration(tagGenerations, tag)
  memoryCache.invalidateTags(tags)
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

export function providerCacheTag(providerId: string): string {
  return `provider:${providerId}`
}

export function zoneCacheTag(providerType: string, providerId: string): string {
  return `${providerType}:zones:${providerId}`
}

/** 解析线路按域名套餐变化，标签需带域名 */
export function recordLineCacheTag(providerType: string, providerId: string, zone: string): string {
  return `${providerType}:lines:${providerId}:${zone}`
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
