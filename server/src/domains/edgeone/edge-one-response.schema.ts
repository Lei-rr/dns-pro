/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../kernel/http/api-error.js'
import { asRecord, asRecordArray, requireField, requireRecord } from '../../kernel/providers/response-guards.js'
export type EdgeOneZone = Record<string, any>
export type EdgeOneAccelerationDomain = Record<string, any>

export const edgeOneZoneSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const edgeOneAccelerationDomainSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, OriginDetail: asRecord(r.OriginDetail), Certificate: asRecord(r.Certificate) }
  },
}
export const edgeoneZoneListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v, 'edgeone_invalid_response', 'EdgeOne')
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
    const r = requireRecord(v, 'edgeone_invalid_response', 'EdgeOne')
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
    const r = requireRecord(v, 'edgeone_invalid_response', 'EdgeOne')
    requireField(r, 'RequestId', 'edgeone_invalid_response', 'EdgeOne')
    return { ...r, RequestId: r.RequestId, OwnershipVerification: r.OwnershipVerification }
  },
}
export const edgeoneMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v, 'edgeone_invalid_response', 'EdgeOne')
    requireField(r, 'RequestId', 'edgeone_invalid_response', 'EdgeOne')
    return r
  },
}
