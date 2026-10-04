import type { SideEffects } from '../providers/side-effect-result.js'
import { translateError } from './error-messages.js'

interface SuccessResponseBody<T = unknown> {
  code: 0
  message: 'success'
  data: T
  side_effects?: SideEffects
}

interface ErrorResponseBody {
  message: string
  code: string
  status: number
  details: unknown
}

export function success<T>(data: T, sideEffects?: SideEffects): SuccessResponseBody<T> {
  return {
    code: 0,
    message: 'success',
    data,
    side_effects: sideEffects,
  }
}

export function error(
  message: string,
  statusCode: number = 400,
  errorCode?: string,
  details: unknown = undefined
): ErrorResponseBody {
  const code = errorCode ?? 'error'
  const provided = String(message ?? '').trim()
  const translated = translateError(code)
  // 已本地化（含中文）的消息原样返回；否则优先使用错误码的中文映射，
  // 避免内部英文错误文本直接暴露在中文界面上。
  const localized = /[\u4e00-\u9fff]/.test(provided)
  return {
    message: localized ? provided : (translated ?? provided),
    code,
    status: statusCode,
    details,
  }
}

export function noContent(): null {
  return null
}
