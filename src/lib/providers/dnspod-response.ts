export type DnspodDomain = Record<string, any>
export type DnspodRecord = Record<string, any>
export type DnspodDomainInfo = Record<string, any>
export type DnspodResponse = { Response: Record<string, any>; RequestId?: string }

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
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
      EffectiveDNS: asArray(r.EffectiveDNS),
    }
  },
}
export const dnspodRecordSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const dnspodDomainInfoSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      GradeNsList: asArray(r.GradeNsList),
    }
  },
}
export const dnspodDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      DomainList: asArray(r.DomainList),
      DomainCountInfo: asRecord(r.DomainCountInfo),
      RequestId: r.RequestId,
    }
  },
}
export const dnspodDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, DomainInfo: r.DomainInfo ?? {}, RequestId: r.RequestId }
  },
}
export const dnspodRecordListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return {
      ...r,
      RecordList: asArray(r.RecordList),
      RecordCountInfo: asRecord(r.RecordCountInfo),
      RequestId: r.RequestId,
    }
  },
}
export const dnspodRecordMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, RecordId: r.RecordId, RequestId: r.RequestId }
  },
}
