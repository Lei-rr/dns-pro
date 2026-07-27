/** URL path segment encode (shared by feature APIs). */
export function encodePath(value: string): string {
  return encodeURIComponent(value)
}
