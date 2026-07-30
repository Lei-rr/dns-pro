import type { RequestError } from '@/shared/api/http'

export type FieldErrors = Record<string, string>

export function fieldError(errors: FieldErrors, key: string): string[] {
  const message = errors[key]
  return message ? [message] : []
}

function fieldMessage(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(fieldMessage).filter(Boolean).join('，')
  if (value && typeof value === 'object' && 'message' in value) {
    return fieldMessage((value as { message?: unknown }).message)
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
    const target = aliases[key] || key
    if (message && !result[target]) result[target] = message
  }
  return result
}
