import type { RequestError } from '@/shared/api/http'
import { ownValue } from '@/shared/lib/own-value'

export type FieldErrors = Record<string, string>

export function fieldError(errors: FieldErrors, key: string): string[] {
  const message = ownValue<string>(errors, key)
  return message ? [message] : []
}

function fieldMessage(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(fieldMessage).filter(Boolean).join('，')
  if (value && typeof value === 'object') {
    if ('message' in value) return fieldMessage((value as { message?: unknown }).message)
    // 没有 message 的对象取不出可读文案：回空串交给调用方兜底，避免 '[object Object]' 落到界面上
    return ''
  }
  return value === undefined || value === null ? '' : String(value).trim()
}

export function serverFieldErrors(error: unknown, aliases: Record<string, string> = {}): FieldErrors {
  const details = (error as RequestError | undefined)?.details
  if (!details || typeof details !== 'object') return {}
  const source = (details as { errors?: unknown }).errors
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  const result: FieldErrors = {}
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const message = fieldMessage(value)
    const target = ownValue<string>(aliases, key) ?? key
    if (message && !ownValue<string>(result, target)) result[target] = message
  }
  return result
}
