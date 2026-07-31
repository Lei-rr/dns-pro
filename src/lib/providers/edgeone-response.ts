/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type EdgeOneZone = Record<string, any>
export type EdgeOneAccelerationDomain = Record<string, any>
export type EdgeoneResponse = { Response: Record<string, any>; RequestId?: string }

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function requireRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EdgeOne invalid mutation response')
  }
  return value as Record<string, any>
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function asRecordArray(value: unknown): Array<Record<string, any>> {
  return asArray(value).filter((item) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0)
}

export function parseEdgeoneResponse(response: unknown): { Response: Record<string, unknown>; RequestId?: string } {
  const root = asRecord(response)
  const Response = asRecord(root.Response ?? root)
  return { Response, RequestId: Response.RequestId ? String(Response.RequestId) : undefined }
}

export const edgeOneZoneSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const edgeOneAccelerationDomainSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      OriginDetail: asRecord(r.OriginDetail),
      Certificate: asRecord(r.Certificate),
    }
  },
}
export const edgeoneZoneListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      Zones: asRecordArray(r.Zones),
      SourceCount: asArray(r.Zones).length,
      TotalCount: r.TotalCount ?? null,
      RequestId: r.RequestId ?? null,
    }
  },
}
export const edgeoneAccelerationDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      AccelerationDomains: asRecordArray(r.AccelerationDomains),
      SourceCount: asArray(r.AccelerationDomains).length,
      TotalCount: r.TotalCount ?? null,
      RequestId: r.RequestId ?? null,
    }
  },
}
export const edgeoneAccelerationDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    return { ...r, RequestId: r.RequestId, OwnershipVerification: r.OwnershipVerification }
  },
}
export const edgeoneMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    return { ...r, RequestId: r.RequestId }
  },
}
export const edgeoneResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, Response: asRecord(r.Response ?? r) }
  },
}
