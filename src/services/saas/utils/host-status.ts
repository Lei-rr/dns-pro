import type { CloudflareCustomHostname } from '../../../gateways/cloudflare-custom-hostname-gateway.js'

export function isHostnameActive(hostname: CloudflareCustomHostname): boolean {
  return ['active', 'active_renewing', 'moved'].includes(String(hostname.status ?? ''))
}
