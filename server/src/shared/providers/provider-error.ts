import { ApiError } from '../http/api-error.js'

function upstreamStatus(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null
  const details = error.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = Number((details as Record<string, unknown>).upstream_status)
  return Number.isInteger(value) ? value : null
}

type ExplicitNotFoundOptions = {
  providerCode?: RegExp
  localCodes?: readonly string[]
}

export function isExplicitNotFound(error: unknown, options: ExplicitNotFoundOptions = {}): boolean {
  if (!(error instanceof ApiError)) return false
  if (upstreamStatus(error) === 404) return true
  if (options.localCodes?.includes(error.code)) return true
  if (!options.providerCode) return false
  const details = error.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false
  return options.providerCode.test(String((details as Record<string, unknown>).code ?? ''))
}
