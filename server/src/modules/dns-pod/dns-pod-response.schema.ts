/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../shared/http/api-error.js'
import {
  asArray,
  asRecord,
  asRecordArray,
  requireField,
  requireRecord,
} from '../../shared/providers/response-guards.js'
export type DnsPodDomain = Record<string, any>
export type DnsPodRecord = Record<string, any>

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
    const r = requireRecord(v, 'dnspod_invalid_response', 'DNSPod')
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
    const r = requireRecord(v, 'dnspod_invalid_response', 'DNSPod')
    requireField(r, 'DomainInfo', 'dnspod_invalid_response', 'DNSPod')
    return { ...r, DomainInfo: r.DomainInfo, RequestId: r.RequestId }
  },
}
export const dnspodMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v, 'dnspod_invalid_response', 'DNSPod')
    requireField(r, 'RequestId', 'dnspod_invalid_response', 'DNSPod')
    return r
  },
}
export const dnspodRecordListResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v, 'dnspod_invalid_response', 'DNSPod')
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
    requireField(r, 'RecordId', 'dnspod_invalid_response', 'DNSPod')
    return r
  },
}
