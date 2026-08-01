import { ApiError } from '../http/api-error.js'

export function upstreamStatus(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null
  const details = error.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = Number((details as Record<string, unknown>).upstream_status)
  return Number.isInteger(value) ? value : null
}

export function isExplicitNotFound(error: unknown, providerCode?: RegExp): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.statusCode === 404 || upstreamStatus(error) === 404) return true
  if (!providerCode) return false
  const details = error.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false
  return providerCode.test(String((details as Record<string, unknown>).code ?? ''))
}
