/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../../core/http/api-error.js'
import { asRecord, asRecordArray, requireField, requireRecord } from '../../core/providers/response-guards.js'
export type EdgeOneZone = Record<string, any>
export type EdgeOneAccelerationDomain = Record<string, any>

export const edgeOneZoneSchema = { parse: (v: unknown): Record<string, any> => asRecord(v) }
export const edgeOneAccelerationDomainSchema = {
  parse: (v: unknown): Record<string, any> => {
    const r = asRecord(v)
    return { ...r, OriginDetail: asRecord(r.OriginDetail), Certificate: asRecord(r.Certificate) }
  },
}
/**
 * 列表响应归一：校验列表字段、展开原记录，SourceCount 取原始条目数
 * （分页偏移按上游条目数推进，因此不能用过滤后的长度）。
 */
function listResponseSchema(value: unknown, listField: string, label: string): Record<string, any> {
  const r = requireRecord(value, 'edgeone_invalid_response', 'EdgeOne')
  const list = r[listField]
  if (!Array.isArray(list)) {
    throw new ApiError('edgeone_invalid_response', `EdgeOne invalid ${label} list response`, 502)
  }
  return {
    ...r,
    [listField]: asRecordArray(list),
    SourceCount: list.length,
    TotalCount: r.TotalCount ?? null,
    RequestId: r.RequestId ?? null,
  }
}
export const edgeoneZoneListResponseSchema = {
  parse: (v: unknown): Record<string, any> => listResponseSchema(v, 'Zones', 'zone'),
}
export const edgeoneAccelerationDomainListResponseSchema = {
  parse: (v: unknown): Record<string, any> => listResponseSchema(v, 'AccelerationDomains', 'domain'),
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
