/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../core/http/api-error.js'
import { asArray, asRecord, asRecordArray, requireField, requireRecord } from '../../core/providers/response-guards.js'
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
/**
 * 列表响应归一：校验列表字段、展开原记录，SourceCount 取原始条目数
 * （分页偏移按上游条目数推进，因此不能用过滤后的长度）。
 */
function listResponseSchema(
  value: unknown,
  listField: string,
  label: string,
  extra?: (record: Record<string, any>) => Record<string, any>
): Record<string, any> {
  const r = requireRecord(value, 'dnspod_invalid_response', 'DNSPod')
  const list = r[listField]
  if (!Array.isArray(list)) {
    throw new ApiError('dnspod_invalid_response', `DNSPod invalid ${label} list response`, 502)
  }
  return { ...r, [listField]: asRecordArray(list), SourceCount: list.length, ...extra?.(r) }
}
export const dnspodDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> =>
    listResponseSchema(v, 'DomainList', 'domain', (r) => ({ DomainCountInfo: asRecord(r.DomainCountInfo) })),
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
    listResponseSchema(v, 'RecordList', 'record', (r) => ({ RecordCountInfo: asRecord(r.RecordCountInfo) })),
}
export const dnspodRecordLineListResponseSchema = {
  parse: (v: unknown): Record<string, any> =>
    listResponseSchema(v, 'LineList', 'record line', (r) => ({ LineGroupList: asRecordArray(r.LineGroupList) })),
}
export const dnspodRecordMutationResponseSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = dnspodMutationResponseSchema.parse(v)
    requireField(r, 'RecordId', 'dnspod_invalid_response', 'DNSPod')
    return r
  },
}
