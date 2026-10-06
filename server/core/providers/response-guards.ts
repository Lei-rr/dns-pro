/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../http/api-error.js'

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

/** 与 asRecord 同判据，但非普通对象时为 null：用于「对象或空」的可选字段呈现 */
export function asRecordOrNull(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null
}

export function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

export function asRecordArray(value: unknown): Array<Record<string, any>> {
  return asArray(value).filter(
    (item) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0
  )
}

export function requireRecord(value: unknown, code: string, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(code, `${label} invalid response`, 502)
  }
  return value as Record<string, any>
}

export function requireField(record: Record<string, any>, field: string, code: string, label: string): void {
  if (record[field] === undefined || record[field] === null) {
    throw new ApiError(code, `${label} response missing ${field}`, 502)
  }
}

type ListResponseOptions = {
  code: string
  /** 服务商标识，用于错误消息（如 'DNSPod'） */
  label: string
  /** 上游数组字段名 */
  listField: string
  /** 条目语义，用于错误消息（如 'domain'） */
  itemLabel: string
  extra?: (record: Record<string, any>) => Record<string, any>
}

/**
 * 列表响应归一：校验列表字段、展开原记录，SourceCount 取原始条目数
 * （分页偏移按上游条目数推进，因此不能用过滤后的长度）。
 * 腾讯云系（DNSPod / EdgeOne）的列表响应同构，仅数组字段名与文案不同，共用本工厂。
 */
export function normalizeListResponse(value: unknown, options: ListResponseOptions): Record<string, any> {
  const record = requireRecord(value, options.code, options.label)
  const list = record[options.listField]
  if (!Array.isArray(list)) {
    throw new ApiError(options.code, `${options.label} invalid ${options.itemLabel} list response`, 502)
  }
  return {
    ...record,
    [options.listField]: asRecordArray(list),
    SourceCount: list.length,
    ...options.extra?.(record),
  }
}
