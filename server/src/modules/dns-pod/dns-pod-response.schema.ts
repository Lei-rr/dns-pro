/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../shared/http/api-error.js'

export type DnsPodDomain = Record<string, any>
export type DnsPodRecord = Record<string, any>
export type DnsPodDomainInfo = Record<string, any>
export type DnsPodResponse = { Response: Record<string, any>; RequestId?: string }

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function requireRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('dnspod_invalid_response', 'DNSPod invalid response', 502)
  }
  return value as Record<string, any>
}

function requireField(record: Record<string, any>, field: string): void {
  if (record[field] === undefined || record[field] === null) {
    throw new ApiError('dnspod_invalid_response', `DNSPod response missing ${field}`, 502)
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

export function parseDnsPodResponse(response: unknown): { Response: Record<string, unknown>; RequestId?: string } {
  const root = asRecord(response)
  const Response = asRecord(root.Response ?? root)
  return { Response, RequestId: Response.RequestId ? String(Response.RequestId) : undefined }
}

export const dnspodDomainSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, EffectiveDNS: asArray(r.EffectiveDNS).filter((item) => typeof item === 'string') }
  },
}
export const dnspodRecordSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const dnspodDomainInfoSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, GradeNsList: asArray(r.GradeNsList).filter((item) => typeof item === 'string') }
  },
}
export const dnspodDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    if (!Array.isArray(r.DomainList)) {
      throw new ApiError('dnspod_invalid_response', 'DNSPod invalid domain list response', 502)
    }
    return {
      ...r,
      DomainList: asRecordArray(r.DomainList),
      SourceCount: r.DomainList.length,
      DomainCountInfo: asRecord(r.DomainCountInfo),
      RequestId: r.RequestId,
    }
  },
}
export const dnspodDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    requireField(r, 'DomainInfo')
    return { ...r, DomainInfo: r.DomainInfo, RequestId: r.RequestId }
  },
}
export const dnspodMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    requireField(r, 'RequestId')
    return r
  },
}
export const dnspodRecordListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v)
    if (!Array.isArray(r.RecordList)) {
      throw new ApiError('dnspod_invalid_response', 'DNSPod invalid record list response', 502)
    }
    return {
      ...r,
      RecordList: asRecordArray(r.RecordList),
      SourceCount: r.RecordList.length,
      RecordCountInfo: asRecord(r.RecordCountInfo),
      RequestId: r.RequestId,
    }
  },
}
export const dnspodRecordMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = dnspodMutationResponseSchema.parse(v)
    requireField(r, 'RecordId')
    return r
  },
}
