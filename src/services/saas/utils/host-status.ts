export function isHostnameActive(hostname: Record<string, unknown>): boolean {
  return ['active', 'active_renewing', 'moved'].includes(String(hostname.status ?? ''))
}
