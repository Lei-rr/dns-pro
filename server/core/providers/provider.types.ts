/**
 * 服务商类型白名单：类型别名与 HTTP 校验 schema 共用同一份事实来源。
 * 新增类型只改这里，schema 自动跟随，不会再出现「TS 编译通过、HTTP 400 拒收」的漂移。
 */
export const PROVIDER_TYPES = ['dnspod', 'cloudflare', 'edgeone', 'saas', 'cloudflared'] as const

export type ProviderType = (typeof PROVIDER_TYPES)[number]

export interface ProviderDefinition {
  type: ProviderType
  name: string
  fields: string[]
  required: string[]
  secret_fields: string[]
  labels: Record<string, string>
}

interface BaseProvider {
  type: ProviderType
  id: string
  name: string
  [key: string]: unknown
}

export interface DnsPodProvider extends BaseProvider {
  type: 'dnspod'
  secret_id: string
  secret_key: string
}

export interface CloudflareProvider extends BaseProvider {
  type: 'cloudflare'
  api_token: string
  account_id: string
}

export interface EdgeOneProvider extends BaseProvider {
  type: 'edgeone'
  dnspod_provider: string
}

export interface SaaSProvider extends BaseProvider {
  type: 'saas'
  cloudflare_provider: string
  dnspod_provider?: string
  cloudflare_dns_provider?: string
}

export interface CloudflaredProvider extends BaseProvider {
  type: 'cloudflared'
  cloudflare_provider: string
}

export type Provider = DnsPodProvider | CloudflareProvider | EdgeOneProvider | SaaSProvider | CloudflaredProvider

export type ProviderInput = Provider

export interface PresentedProvider extends BaseProvider {
  [key: string]: unknown
  configured: boolean
  fields: Record<string, string>
  editable_fields: string[]
}
