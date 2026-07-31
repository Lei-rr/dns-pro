/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type DnspodDomain = Record<string, any>
export type DnspodRecord = Record<string, any>
export type DnspodDomainInfo = Record<string, any>
export type DnspodResponse = { Response: Record<string, any>; RequestId?: string }

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function requireRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DNSPod invalid mutation response')
  }
  return value as Record<string, any>
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function asRecordArray(value: unknown): Array<Record<string, any>> {
  return asArray(value).filter((item) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0)
}

export function parseDnspodResponse(response: unknown): { Response: Record<string, unknown>; RequestId?: string } {
  const root = asRecord(response)
  const Response = asRecord(root.Response ?? root)
  return { Response, RequestId: Response.RequestId ? String(Response.RequestId) : undefined }
}

export const dnspodDomainSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      EffectiveDNS: asArray(r.EffectiveDNS).filter((item) => typeof item === 'string'),
    }
  },
}
export const dnspodRecordSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const dnspodDomainInfoSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      GradeNsList: asArray(r.GradeNsList).filter((item) => typeof item === 'string'),
    }
  },
}
export const dnspodDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      DomainList: asRecordArray(r.DomainList),
      SourceCount: asArray(r.DomainList).length,
      DomainCountInfo: asRecord(r.DomainCountInfo),
      RequestId: r.RequestId,
    }
  },
}
export const dnspodDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    return { ...r, DomainInfo: r.DomainInfo ?? {}, RequestId: r.RequestId }
  },
}
export const dnspodRecordListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      RecordList: asRecordArray(r.RecordList),
      SourceCount: asArray(r.RecordList).length,
      RecordCountInfo: asRecord(r.RecordCountInfo),
      RequestId: r.RequestId,
    }
  },
}
export const dnspodRecordMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    return { ...r, RecordId: r.RecordId, RequestId: r.RequestId }
  },
}
