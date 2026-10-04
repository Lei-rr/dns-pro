/* Vendor payloads are intentionally loose — presenters coerce fields. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from '../http/api-error.js'

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
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
