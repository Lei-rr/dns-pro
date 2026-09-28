import { encodePath } from '@/shared/lib/path'

export function providerPath(providerId: string) {
  return '/' + encodePath(providerId)
}

export function providerTypeLabel(type: string) {
  const map: Record<string, string> = {
    dnspod: 'DNSPod',
    cloudflare: 'Cloudflare',
    saas: 'Cloudflare SaaS',
    edgeone: 'EdgeOne',
    cloudflared: 'Cloudflare Tunnel',
  }
  return map[type] || type
}
