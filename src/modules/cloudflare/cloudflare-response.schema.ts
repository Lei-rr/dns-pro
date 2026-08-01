/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../shared/http/api-error.js'

export type CloudflareZone = Record<string, any>
export type CloudflareDnsRecord = Record<string, any>
export type CloudflareResultInfo = Record<string, any>
export type CloudflareCustomHostnameResponse = Record<string, any>
export type CloudflareApiResponse = {
  success?: boolean
  errors?: unknown[]
  messages?: unknown[]
  result?: unknown
  result_info?: Record<string, any>
}
export type CloudflareFallbackOrigin = Record<string, any>
export type CloudflareTunnel = Record<string, any>
export type CloudflareRouteConfig = Record<string, any>

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function asRecordArray(value: unknown): Array<Record<string, any>> {
  return asArray(value).filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0
  )
}

export function parseCloudflareListResponse<T = Record<string, any>>(
  response: unknown
): { result: T[]; result_info: CloudflareResultInfo | undefined; source_count: number } {
  const parsed = asRecord(response)
  if (!Array.isArray(parsed.result)) {
    throw new ApiError('cloudflare_invalid_response', 'Cloudflare returned an invalid list response', 502)
  }
  const resultInfo = parsed.result_info ? asRecord(parsed.result_info) : undefined
  const source = parsed.result
  return {
    result: asRecordArray(source) as T[],
    result_info: resultInfo,
    source_count: source.length,
  }
}

export function parseCloudflareItemResponse<T = any>(response: unknown): { result: T } {
  const parsed = asRecord(response)
  const result = parsed.result
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length === 0) {
    throw new ApiError('cloudflare_invalid_response', 'Cloudflare returned an invalid item response', 502)
  }
  return { result: result as T }
}

export const cloudflareZoneSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      name_servers: asArray(r.name_servers).filter((item) => typeof item === 'string'),
      original_name_servers: asArray(r.original_name_servers).filter((item) => typeof item === 'string'),
    }
  },
}
export const cloudflareDnsRecordSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      tags: asArray(r.tags).filter((item) => typeof item === 'string'),
    }
  },
}
export const cloudflareCustomHostnameSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      ssl: asRecord(r.ssl),
      ownership_verification: asRecord(r.ownership_verification),
    }
  },
}
export const cloudflareResultInfoSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const cloudflareApiResponseSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
