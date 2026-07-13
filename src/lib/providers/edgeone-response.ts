export type EdgeOneZone = Record<string, any>
export type EdgeOneAccelerationDomain = Record<string, any>
export type EdgeoneResponse = { Response: Record<string, any>; RequestId?: string }

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
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
      Zones: asArray(r.Zones),
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
      AccelerationDomains: asArray(r.AccelerationDomains),
      TotalCount: r.TotalCount ?? null,
      RequestId: r.RequestId ?? null,
    }
  },
}
export const edgeoneAccelerationDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, RequestId: r.RequestId, OwnershipVerification: r.OwnershipVerification }
  },
}
export const edgeoneMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, RequestId: r.RequestId }
  },
}
export const edgeoneResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, Response: asRecord(r.Response ?? r) }
  },
}
