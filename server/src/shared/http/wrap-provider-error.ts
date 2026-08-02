import { ApiError } from './api-error.js'

/** Map unknown errors to ApiError without double-wrapping existing ApiError. */
export function wrapProviderError(
  code: string,
  message: string,
  providerId: string,
  error: unknown,
  details: Record<string, unknown> = {}
): ApiError {
  if (error instanceof ApiError) return error
  const err = error instanceof Error ? error : new Error(String(error))
  return new ApiError(code, message, 502, {
    ...details,
    provider_id: providerId,
    error: err.message,
  })
}
