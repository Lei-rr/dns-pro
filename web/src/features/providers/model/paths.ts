import { encodePath } from '@/shared/lib/path'

/** 服务商详情挂在 /p/:provider 前缀下，避免与 /sync、/providers 等系统路由同名冲突（见 app/router/index.ts） */
export function providerPath(providerId: string) {
  return '/p/' + encodePath(providerId)
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
