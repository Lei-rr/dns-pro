import { activeMemoryCache } from './memory-cache.js'

type CachedResult<T> = {
  value: T
}

type CacheKey = string | { prefix: string; parts: Record<string, unknown> }

type ProviderCacheOptions<T> = {
  key: CacheKey
  tags?: string[]
  refresh?: boolean
  loader: () => Promise<T>
}

type InflightEntry = {
  promise: Promise<CachedResult<unknown>>
  tagGenerations: ReadonlyArray<readonly [string, number]>
}

/**
 * 代次与在途状态：封装成实例，由装配层安装（与内存缓存同路径，见 app/lifecycle.ts）。
 * 代次仅用于拦截「失效后才完成的在途加载」。
 */
class ProviderCacheState {
  /** 容量上限：超限淘汰后比较结果不相等，只会放弃写入（失败方向是安全的）。 */
  private static readonly GENERATION_LIMIT = 4096

  private readonly tagGenerations = new Map<string, number>()
  private readonly loadGenerations = new Map<string, number>()
  private readonly inflight = new Map<string, InflightEntry>()

  tagGeneration(tag: string): number {
    return this.tagGenerations.get(tag) ?? 0
  }

  loadGeneration(key: string): number {
    return this.loadGenerations.get(key) ?? 0
  }

  pending(key: string): InflightEntry | undefined {
    return this.inflight.get(key)
  }

  bumpTag(tag: string): void {
    this.bump(this.tagGenerations, tag)
  }

  bumpLoad(key: string): void {
    this.bump(this.loadGenerations, key)
  }

  track(key: string, entry: InflightEntry): void {
    this.inflight.set(key, entry)
  }

  release(key: string, entry: InflightEntry): void {
    if (this.inflight.get(key) === entry) this.inflight.delete(key)
  }

  /** 有上限的写入：超出后淘汰最早插入的键 */
  private bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1)
    while (map.size > ProviderCacheState.GENERATION_LIMIT) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }
}

/** 当前进程使用的代次状态：由装配层在启动阶段安装（见 app/lifecycle.ts 的 initKernel），
 * 与内存缓存同一路径；重复装配（探针）各从干净状态开始，不再需要手工清理 */
let activeState = new ProviderCacheState()

/** 安装新的代次状态：装配层每次装配调用；同一进程内重复装配不会串用旧实例的代数 */
export function installProviderCacheState(): void {
  activeState = new ProviderCacheState()
}

/**
 * 供应商查询：缓存优先。冷缺失回填，refresh 绕过并覆盖。
 * 条目带存活时间与容量上限，见 memory-cache。
 */
export async function withProviderCache<T>(options: ProviderCacheOptions<T>): Promise<CachedResult<T>> {
  const key = resolveKey(options.key)
  const tags = options.tags ?? []
  const cache = activeMemoryCache()
  // 读一次：本次调用内代次口径一致（安装只发生在装配期，与请求期不交错）
  const state = activeState

  if (!options.refresh) {
    const hit = cache.get<T>(key)
    if (hit !== undefined) {
      return { value: hit }
    }
    const pending = state.pending(key)
    if (pending && pending.tagGenerations.every(([tag, generation]) => generation === state.tagGeneration(tag))) {
      return pending.promise as Promise<CachedResult<T>>
    }
  }

  const fence = {
    tags: tags.map((tag) => [tag, state.tagGeneration(tag)] as const),
    load: state.loadGeneration(key) + 1,
  }
  state.bumpLoad(key)
  const loading = (async (): Promise<CachedResult<T>> => {
    const value = await options.loader()
    const current =
      fence.load === state.loadGeneration(key) &&
      fence.tags.every(([tag, generation]) => generation === state.tagGeneration(tag))
    if (current) cache.set(key, value, tags)

    return { value }
  })()
  const inflightEntry: InflightEntry = { promise: loading, tagGenerations: fence.tags }
  if (!options.refresh) state.track(key, inflightEntry)
  try {
    return await loading
  } finally {
    state.release(key, inflightEntry)
  }
}

/** 按标签失效：标签覆盖 provider/zone/record 等维度，同时拦截在途加载的写入 */
export function invalidateProviderCache(options: { tags?: string[] }): void {
  const tags = options.tags ?? []
  for (const tag of tags) activeState.bumpTag(tag)
  activeMemoryCache().invalidateTags(tags)
}

export function providerCacheStats(): { size: number } {
  return activeMemoryCache().stats()
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

export function edgeoneDomainsCacheTag(providerId: string, zoneId: string): string {
  return `edgeone:modules:${providerId}:${zoneId}`
}

export function cloudflaredTunnelsCacheTag(providerId: string): string {
  return `cloudflared:tunnels:${providerId}`
}

export function cloudflaredTunnelConfigCacheTag(providerId: string, tunnelId: string): string {
  return `cloudflared:tunnel_config:${providerId}:${tunnelId}`
}
