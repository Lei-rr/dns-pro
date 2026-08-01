import type { CloudflareCustomHostname } from './saas-custom-hostname.client.js'

export function isHostnameActive(hostname: CloudflareCustomHostname): boolean {
  return ['active', 'active_renewing', 'moved'].includes(String(hostname.status ?? ''))
}
