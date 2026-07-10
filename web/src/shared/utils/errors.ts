export function errorMessage(error: unknown, fallback = '请求失败'): string {
  if (typeof error === 'string') return error
  if (error && typeof (error as Error).message === 'string' && (error as Error).message.trim() !== '') {
    return (error as Error).message
  }
  return fallback
}
