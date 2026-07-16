import { globalCache } from './cache-service.js'
import { buildCacheKey } from './cache-helpers.js'
import { getDataRoot } from '../storage/json-store.js'
import fs from 'node:fs/promises'
import path from 'node:path'

export type CacheStoreKind = 'memory' | 'file' | 'layered'

export type CacheReadMode = {
  refresh?: boolean
  cacheOnly?: boolean
}

export type CacheSource = 'memory' | 'file' | 'loader' | 'miss'

export type CacheMeta = {
  cache: boolean
  cached: boolean
  source: CacheSource
  store: CacheStoreKind
}

export type CacheResult<T> = {
  value: T
  hit: boolean
  meta: CacheMeta
}

export type CacheGetOrLoadOptions<T> = {
  key: string | { prefix: string; parts: Record<string, unknown> }
  store?: CacheStoreKind
  ttlMs: number
  tags?: string[]
  mode?: CacheReadMode
  namespace?: string
  emptyOnMiss?: T
  loader?: () => Promise<T>
}

type FileCacheEnvelope<T> = {
  value: T
  expiresAt: number
  tags: string[]
  updatedAt: number
}

const DEFAULT_NAMESPACE = 'default'

function resolveKey(key: string | { prefix: string; parts: Record<string, unknown> }): string {
  return typeof key === 'string' ? key : buildCacheKey(key.prefix, key.parts)
}

function safeFileName(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180)
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

function filePathFor(namespace: string, key: string): string {
  return path.join(getDataRoot(), 'cache', namespace, `${safeFileName(key)}.json`)
}

async function readFileCache<T>(namespace: string, key: string): Promise<FileCacheEnvelope<T> | undefined> {
  const filePath = filePathFor(namespace, key)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    if (!raw.trim()) return undefined
    const parsed = JSON.parse(raw) as FileCacheEnvelope<T>
    if (!parsed || typeof parsed !== 'object') return undefined
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) {
      fs.unlink(filePath).catch(() => undefined)
      return undefined
    }
    return parsed
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') return undefined
    return undefined
  }
}

async function writeFileCache<T>(namespace: string, key: string, value: T, ttlMs: number, tags: string[]): Promise<void> {
  const filePath = filePathFor(namespace, key)
  await ensureDir(path.dirname(filePath))
  const envelope: FileCacheEnvelope<T> = {
    value,
    expiresAt: Date.now() + Math.max(1000, ttlMs),
    tags,
    updatedAt: Date.now(),
  }
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(envelope)}\n`, 'utf-8')
  await fs.rename(tmp, filePath)
}

async function deleteFileCache(namespace: string, key: string): Promise<void> {
  try {
    await fs.unlink(filePathFor(namespace, key))
  } catch {
    // ignore
  }
}

async function invalidateFileCacheByTags(namespace: string, tags: string[]): Promise<void> {
  if (!tags.length) return
  const dir = path.join(getDataRoot(), 'cache', namespace)
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return
  }
  const tagSet = new Set(tags)
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const filePath = path.join(dir, name)
        try {
          const raw = await fs.readFile(filePath, 'utf-8')
          const parsed = JSON.parse(raw) as FileCacheEnvelope<unknown>
          const fileTags = Array.isArray(parsed?.tags) ? parsed.tags : []
          if (fileTags.some((tag) => tagSet.has(tag))) await fs.unlink(filePath)
        } catch {
          // ignore
        }
      }),
  )
}

export class CacheManager {
  async getOrLoad<T>(options: CacheGetOrLoadOptions<T>): Promise<CacheResult<T>> {
    const store = options.store ?? 'memory'
    const mode = {
      refresh: Boolean(options.mode?.refresh),
      cacheOnly: Boolean(options.mode?.cacheOnly) || !Boolean(options.mode?.refresh),
    }
    const key = resolveKey(options.key)
    const tags = options.tags ?? []
    const namespace = options.namespace ?? DEFAULT_NAMESPACE
    const ttlMs = options.ttlMs

    if (!mode.refresh) {
      if (store === 'memory' || store === 'layered') {
        const memoryHit = globalCache.get<T>(key)
        if (memoryHit !== undefined) {
          return {
            value: memoryHit,
            hit: true,
            meta: { cache: true, cached: true, source: 'memory', store },
          }
        }
      }

      if (store === 'file' || store === 'layered') {
        const fileHit = await readFileCache<T>(namespace, key)
        if (fileHit) {
          if (store === 'layered') {
            const remainTtl = Math.max(1000, fileHit.expiresAt - Date.now())
            globalCache.set(key, fileHit.value, remainTtl, fileHit.tags?.length ? fileHit.tags : tags)
          }
          return {
            value: fileHit.value,
            hit: true,
            meta: { cache: true, cached: true, source: 'file', store },
          }
        }
      }

      if (mode.cacheOnly || !options.loader) {
        return {
          value: options.emptyOnMiss as T,
          hit: false,
          meta: { cache: false, cached: false, source: 'miss', store },
        }
      }
    } else if (!options.loader) {
      return {
        value: options.emptyOnMiss as T,
        hit: false,
        meta: { cache: false, cached: false, source: 'miss', store },
      }
    }

    const value = await options.loader!()
    if (store === 'memory' || store === 'layered') globalCache.set(key, value, ttlMs, tags)
    if (store === 'file' || store === 'layered') await writeFileCache(namespace, key, value, ttlMs, tags)

    return {
      value,
      hit: false,
      meta: { cache: false, cached: false, source: 'loader', store },
    }
  }

  async invalidate(options: {
    tags?: string[]
    keys?: string[]
    namespace?: string
    store?: CacheStoreKind | 'all'
  }): Promise<void> {
    const store = options.store ?? 'all'
    const namespace = options.namespace ?? DEFAULT_NAMESPACE
    const tags = options.tags ?? []
    const keys = options.keys ?? []

    if (store === 'memory' || store === 'all' || store === 'layered') {
      if (tags.length) globalCache.invalidateTags(tags)
      for (const key of keys) globalCache.delete(key)
    }
    if (store === 'file' || store === 'all' || store === 'layered') {
      if (tags.length) await invalidateFileCacheByTags(namespace, tags)
      for (const key of keys) await deleteFileCache(namespace, key)
    }
  }

  stats() {
    return globalCache.stats()
  }
}

export const cacheManager = new CacheManager()
export { buildCacheKey, globalCache }
