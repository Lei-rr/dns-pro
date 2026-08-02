/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../shared/http/api-error.js'

export type EdgeOneZone = Record<string, any>
export type EdgeOneAccelerationDomain = Record<string, any>
export type EdgeOneResponse = { Response: Record<string, any>; RequestId?: string }

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}
function requireRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('edgeone_invalid_response', 'EdgeOne invalid response', 502)
  }
  return value as Record<string, any>
}
function requireField(record: Record<string, any>, field: string): void {
  if (record[field] === undefined || record[field] === null) {
    throw new ApiError('edgeone_invalid_response', `EdgeOne response missing ${field}`, 502)
  }
}
function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}
function asRecordArray(value: unknown): Array<Record<string, any>> {
  return asArray(value).filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0
  )
}

export function parseEdgeOneResponse(response: unknown): { Response: Record<string, unknown>; RequestId?: string } {
  const root = asRecord(response)
  const Response = asRecord(root.Response ?? root)
  return { Response, RequestId: Response.RequestId ? String(Response.RequestId) : undefined }
}

export const edgeOneZoneSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const edgeOneAccelerationDomainSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, OriginDetail: asRecord(r.OriginDetail), Certificate: asRecord(r.Certificate) }
  },
}
export const edgeoneZoneListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    if (!Array.isArray(r.Zones)) {
      throw new ApiError('edgeone_invalid_response', 'EdgeOne invalid zone list response', 502)
    }
    return {
      ...r,
      Zones: asRecordArray(r.Zones),
      SourceCount: r.Zones.length,
      TotalCount: r.TotalCount ?? null,
      RequestId: r.RequestId ?? null,
    }
  },
}
export const edgeoneAccelerationDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    if (!Array.isArray(r.AccelerationDomains)) {
      throw new ApiError('edgeone_invalid_response', 'EdgeOne invalid domain list response', 502)
    }
    return {
      ...r,
      AccelerationDomains: asRecordArray(r.AccelerationDomains),
      SourceCount: r.AccelerationDomains.length,
      TotalCount: r.TotalCount ?? null,
      RequestId: r.RequestId ?? null,
    }
  },
}
export const edgeoneAccelerationDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    requireField(r, 'RequestId')
    return { ...r, RequestId: r.RequestId, OwnershipVerification: r.OwnershipVerification }
  },
}
export const edgeoneMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    requireField(r, 'RequestId')
    return r
  },
}
export const edgeoneResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, Response: asRecord(r.Response ?? r) }
  },
}
