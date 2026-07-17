import { parseBool } from './parse-bool.js'

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function queryRecord(request: { query?: unknown }): Record<string, unknown> {
  return asRecord(request.query)
}

export function bodyRecord(request: { body?: unknown }): Record<string, unknown> {
  return asRecord(request.body)
}

export function queryString(query: Record<string, unknown>, key: string, fallback = ''): string {
  const value = query[key]
  if (value === undefined || value === null) return fallback
  return String(value).trim()
}

export function queryInt(query: Record<string, unknown>, key: string, fallback: number, min = 0, max = 10000): number {
  const raw = Number(query[key] ?? fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(raw)))
}

export function queryBool(query: Record<string, unknown>, key: string, fallback = false): boolean {
  if (!(key in query)) return fallback
  return parseBool(query[key])
}

export function bodyString(body: Record<string, unknown>, key: string, fallback = ''): string {
  const value = body[key]
  if (value === undefined || value === null) return fallback
  return String(value).trim()
}
