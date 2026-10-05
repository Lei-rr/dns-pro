/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  asArray,
  asRecord,
  asRecordArray,
  normalizeListResponse,
  requireField,
  requireRecord,
} from '../../core/providers/response-guards.js'
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
  parse: (v: unknown): Record<string, any> =>
    normalizeListResponse(v, {
      code: 'dnspod_invalid_response',
      label: 'DNSPod',
      listField: 'DomainList',
      itemLabel: 'domain',
      extra: (r) => ({ DomainCountInfo: asRecord(r.DomainCountInfo) }),
    }),
}
export const dnspodDomainCreateResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = requireRecord(v, 'dnspod_invalid_response', 'DNSPod')
    requireField(r, 'DomainInfo', 'dnspod_invalid_response', 'DNSPod')
    return r
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
  parse: (v: unknown): Record<string, any> =>
    normalizeListResponse(v, {
      code: 'dnspod_invalid_response',
      label: 'DNSPod',
      listField: 'RecordList',
      itemLabel: 'record',
      extra: (r) => ({ RecordCountInfo: asRecord(r.RecordCountInfo) }),
    }),
}
export const dnspodRecordLineListResponseSchema = {
  parse: (v: unknown): Record<string, any> =>
    normalizeListResponse(v, {
      code: 'dnspod_invalid_response',
      label: 'DNSPod',
      listField: 'LineList',
      itemLabel: 'record line',
      extra: (r) => ({ LineGroupList: asRecordArray(r.LineGroupList) }),
    }),
}
export const dnspodRecordMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = dnspodMutationResponseSchema.parse(v)
    requireField(r, 'RecordId', 'dnspod_invalid_response', 'DNSPod')
    return r
  },
}
