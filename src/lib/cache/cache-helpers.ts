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
  const total = resultInfo?.total_count !== undefined && resultInfo.total_count !== null ? Number(resultInfo.total_count) : null

  return {
    page: resolvedPage,
    per_page: resolvedPerPage,
    offset: Math.max(0, (resolvedPage - 1) * resolvedPerPage),
    limit: resolvedPerPage,
    count,
    total,
    total_pages: resultInfo?.total_pages !== undefined && resultInfo.total_pages !== null ? Number(resultInfo.total_pages) : null,
  }
}

export function buildCacheKey(prefix: string, parts: Record<string, unknown>): string {
  const entries = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      return `${sanitize(String(key))}=${sanitize(stringifyValue(value))}`
    })
  return [prefix, ...entries].join(':')
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return JSON.stringify(value, keys)
  }
  return String(value)
}

function sanitize(segment: string): string {
  return segment.replace(/[:\s]/g, '_')
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
