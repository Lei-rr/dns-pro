import { encodePath } from '@/shared/lib/path'
import { ownValue } from '@/shared/lib/own-value'

/** 服务商详情挂在 /p/:provider 前缀下，避免与 /sync、/providers 等系统路由同名冲突（见 app/router/index.ts） */
export function providerPath(providerId: string) {
  return '/p/' + encodePath(providerId)
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  dnspod: 'DNSPod',
  cloudflare: 'Cloudflare',
  saas: 'Cloudflare SaaS',
  edgeone: 'EdgeOne',
  cloudflared: 'Cloudflare Tunnel',
}

export function providerTypeLabel(type: string) {
  return ownValue<string>(PROVIDER_TYPE_LABELS, type) ?? type
}
