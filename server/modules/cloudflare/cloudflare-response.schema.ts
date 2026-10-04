/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../core/http/api-error.js'
import { asArray, asRecord, asRecordArray } from '../../core/providers/response-guards.js'
export type CloudflareTunnel = Record<string, any>
export type CloudflareRouteConfig = Record<string, any>

export type CloudflareFallbackOrigin = Record<string, any>

/** Cloudflare 单页列表结果 */
export interface CloudflarePage<T> {
  items: T[]
  /** 上游本页原始条数（含被过滤的非法项），用于判断是否还有下一页 */
  sourceCount: number
  totalPages: number | null
  totalCount: number | null
}

export function parseCloudflareListResponse<T>(
  response: unknown,
  present: (item: Record<string, any>) => T
): CloudflarePage<T> {
  const parsed = asRecord(response)
  if (!Array.isArray(parsed.result)) {
    throw new ApiError('cloudflare_invalid_response', 'Cloudflare returned an invalid list response', 502)
  }
  const info = asRecord(parsed.result_info)
  const toNumber = (value: unknown) => (value == null || !Number.isFinite(Number(value)) ? null : Number(value))
  return {
    items: asRecordArray(parsed.result).map(present),
    sourceCount: parsed.result.length,
    totalPages: toNumber(info.total_pages),
    totalCount: toNumber(info.total_count),
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
