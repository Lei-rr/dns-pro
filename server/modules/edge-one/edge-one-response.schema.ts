/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { asRecord, normalizeListResponse, requireField, requireRecord } from '../../core/providers/response-guards.js'
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
  parse: (v: unknown): Record<string, any> =>
    normalizeListResponse(v, {
      code: 'edgeone_invalid_response',
      label: 'EdgeOne',
      listField: 'Zones',
      itemLabel: 'zone',
      extra: (r) => ({ TotalCount: r.TotalCount ?? null, RequestId: r.RequestId ?? null }),
    }),
}
export const edgeoneAccelerationDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> =>
    normalizeListResponse(v, {
      code: 'edgeone_invalid_response',
      label: 'EdgeOne',
      listField: 'AccelerationDomains',
      itemLabel: 'domain',
      extra: (r) => ({ TotalCount: r.TotalCount ?? null, RequestId: r.RequestId ?? null }),
    }),
}
export const edgeoneAccelerationDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v, 'edgeone_invalid_response', 'EdgeOne')
    requireField(r, 'RequestId', 'edgeone_invalid_response', 'EdgeOne')
    return r
  },
}
export const edgeoneMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v, 'edgeone_invalid_response', 'EdgeOne')
    requireField(r, 'RequestId', 'edgeone_invalid_response', 'EdgeOne')
    return r
  },
}
