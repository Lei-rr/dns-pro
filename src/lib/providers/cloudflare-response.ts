/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */

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

export function parseCloudflareListResponse<T = Record<string, any>>(
  response: unknown,
  _itemSchema?: unknown,
): { result: T[]; result_info: CloudflareResultInfo | undefined } {
  const parsed = asRecord(response)
  const resultInfo = parsed.result_info ? asRecord(parsed.result_info) : undefined
  return {
    result: asArray(parsed.result ?? []).map((item) => asRecord(item) as T),
    result_info: resultInfo,
  }
}

export function parseCloudflareItemResponse<T = any>(
  response: unknown,
  _itemSchema?: unknown,
): { result: T } {
  const parsed = asRecord(response)
  const result = parsed.result
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return { result: result as T }
  }
  return { result: asRecord(result ?? {}) as T }
}

export const cloudflareZoneSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      name_servers: asArray(r.name_servers),
      original_name_servers: asArray(r.original_name_servers),
    }
  },
}
export const cloudflareDnsRecordSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      tags: asArray(r.tags),
    }
  },
}
export const cloudflareResultInfoSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
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
export const cloudflareIdResultSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const cloudflareDcvDelegationSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const cloudflareFallbackOriginSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const cloudflareTunnelSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      connections: asArray(r.connections),
    }
  },
}
export const cloudflareRouteConfigSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const cloudflareApiResponseSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
