export function providerPath(providerId: string) {
  return '/' + encodeURIComponent(providerId)
}

export function providerChildPath(providerId: string, childId: string) {
  return providerPath(providerId) + '/' + encodeURIComponent(childId)
}

export function selectedMenuKey(path: string) {
  const first = path.split('/').filter(Boolean)[0] || ''
  return first || 'home'
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
